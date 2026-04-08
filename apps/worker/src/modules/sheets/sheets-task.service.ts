import { Inject, Injectable, Logger } from '@nestjs/common';
import { LockManager, type Lock } from '@link-checker/worker-core';
import {
  REDIS_KEYS,
  colLetterToIndex,
  extractAcceptorHost,
  isValidDonorUrl,
} from '@link-checker/shared';
import type { Link, SheetsTask } from '@link-checker/db';
import { LinkRepository } from '../queue/link.repository';
import { ProgressPublisher } from '../queue/progress.publisher';
import { SingleLinkProcessor } from '../queue/single-link.processor';
import {
  SheetsClientService,
  type FormattedCell,
  type RGB,
  type SheetRow,
} from './sheets-client.service';

const HEARTBEAT_INTERVAL_MS = 10_000;
const PROJECT_LOCK_TTL_MS = 30 * 60 * 1000;
const INTERNAL_CONCURRENCY = 5;

/**
 * Result columns written back to the spreadsheet, starting at
 * `SheetsTask.resultStartCol`. The order is documented in the user-facing
 * docs and the header row, so changing it is a breaking change.
 */
// 6 columns by product spec: status, http, found, indexable, canonical match,
// last checked. Errors are surfaced via the "Status" column ("Error" / "Problem"),
// detailed text lives in the UI link details modal — not in the spreadsheet.
const RESULT_HEADERS = [
  'Status',
  'HTTP',
  'Found',
  'Indexable',
  'Canonical match',
  'Last checked',
] as const;

type RowResult = {
  status: string;
  http: number | string;
  found: string;
  indexable: string;
  canonicalMatch: string;
  lastChecked: string;
};

/**
 * End-to-end runner for one SheetsTask: pull the spreadsheet, sync rows
 * into Link records, run them through the same SingleLinkProcessor that
 * powers manual checks, and write a tabular result block back into the
 * spreadsheet.
 *
 * Lock model: identical to manual-check.processor — we hold a project-wide
 * `lock:project:{id}:sheets` for the duration. Two sheets-tasks within the
 * same project run sequentially; tasks across different projects can run
 * in parallel up to the BullMQ worker concurrency.
 *
 * Why we replace existing Link rows on every run: the simplest mental
 * model. The spreadsheet IS the source of truth — what's in it is what
 * we check. Rows you remove from the sheet disappear from the project on
 * the next run.
 */
@Injectable()
export class SheetsTaskService {
  private readonly logger = new Logger(SheetsTaskService.name);
  private readonly locks: LockManager;

  constructor(
    @Inject('WORKER_REDIS') redis: any,
    private readonly sheetsClient: SheetsClientService,
    private readonly links: LinkRepository,
    private readonly publisher: ProgressPublisher,
    private readonly singleLink: SingleLinkProcessor,
  ) {
    this.locks = new LockManager(redis);
  }

  /**
   * Process one sheets task. Always best-effort: failures are caught,
   * recorded on the SheetsTask row, and surfaced via SSE — never thrown.
   */
  async run(sheetsTaskId: string): Promise<void> {
    const task = await this.links.findSheetsTaskById(sheetsTaskId);
    if (!task) {
      this.logger.warn(`SheetsTask ${sheetsTaskId} not found, skipping`);
      return;
    }

    const lockKey = REDIS_KEYS.projectSheetsLock(task.projectId);
    const lock = await this.locks.acquire(lockKey, { ttlMs: PROJECT_LOCK_TTL_MS });
    if (!lock) {
      this.logger.warn(
        `Project ${task.projectId} already has a sheets check running, skipping ${sheetsTaskId}`,
      );
      return;
    }

    const heartbeat = this.startHeartbeat(lock);

    try {
      await this.links.setSheetsTaskStatus(sheetsTaskId, 'RUNNING', null);
      await this.links.setProjectSheetsChecking(task.projectId, true);
      await this.publishTaskUpdated(task, 'RUNNING', null, null);

      // 1. Resolve the sheet title from its numeric gid (one API call,
      //    cached for the rest of the run via the local variable).
      const sheetTitle = await this.sheetsClient.resolveSheetTitle(
        task.spreadsheetId,
        task.sheetGid,
      );
      if (!sheetTitle) {
        throw new Error(
          `Sheet with gid=${task.sheetGid} not found in spreadsheet ${task.spreadsheetId}`,
        );
      }

      // 2. Pull rows from the sheet
      const rows = await this.sheetsClient.readDonorRows({
        spreadsheetId: task.spreadsheetId,
        sheetTitle,
        donorColumn: task.donorColumn,
        acceptorColumn: task.acceptorColumn,
        dataStartRow: task.dataStartRow,
      });

      // 2. Validate and normalize each row. Invalid rows are kept (so we can
      //    report them in the writeback) but skipped during checking.
      const normalized = rows.map((r) => normalizeRow(r));

      // 3. Replace existing Link records for this task with the fresh batch.
      await this.links.replaceSheetsLinks(
        sheetsTaskId,
        task.projectId,
        normalized.map((n) => ({
          donorUrl: n.donorUrl,
          acceptorRaw: n.acceptor,
          acceptorHost: n.acceptorHost ?? '',
        })),
      );

      // 4. Re-fetch the persisted Link rows in deterministic order so we can
      //    process them through SingleLinkProcessor and later map results
      //    back to spreadsheet rows.
      const persistedLinks = await this.links.findLinksBySheetsTaskOrdered(sheetsTaskId);

      // We must keep the per-spreadsheet-row mapping. The DB ordering
      // matches createMany insertion order which mirrors `normalized`.
      const validProcessableLinks: Link[] = [];
      const sheetRowByLinkId = new Map<string, SheetRow>();

      for (let i = 0; i < persistedLinks.length; i++) {
        const link = persistedLinks[i]!;
        const sheetRow = rows[i]!;
        sheetRowByLinkId.set(link.id, sheetRow);
        const norm = normalized[i]!;
        if (norm.errors.length === 0) {
          validProcessableLinks.push(link);
        } else {
          // Mark invalid rows as ERROR with a friendly reason — they will
          // never enter the crawler.
          await this.links.saveResult(link.id, {
            ok: false,
            donorStatusCode: null,
            donorFinalUrl: null,
            donorRedirectChain: null,
            donorIndexable: null,
            donorMetaRobots: null,
            donorXRobotsTag: null,
            donorCanonical: null,
            canonicalMatches: null,
            linkFound: null,
            occurrences: null,
            occurrencesCount: 0,
            error: `Invalid input: ${norm.errors.join(', ')}`,
            durationMs: 0,
          });
        }
      }

      // 5. Process valid links in parallel chunks. The global Firecrawl
      //    semaphore caps cluster-wide concurrency at 45.
      const total = persistedLinks.length;
      let processed = persistedLinks.length - validProcessableLinks.length;

      for (let i = 0; i < validProcessableLinks.length; i += INTERNAL_CONCURRENCY) {
        const slice = validProcessableLinks.slice(i, i + INTERNAL_CONCURRENCY);
        await Promise.all(slice.map((l) => this.singleLink.processOne(l.id)));
        processed += slice.length;

        const counts = await this.links.getSheetsProgressCounts(sheetsTaskId);
        await this.publisher.publish({
          type: 'sheets_task_progress',
          sheetsTaskId,
          projectId: task.projectId,
          total,
          processed: counts.processed,
          found: counts.found,
          errors: counts.errors,
        });
      }

      // 6. Write results back to the spreadsheet.
      // We MUST re-fetch the links here: the `persistedLinks` array we got
      // before processing has stale `status: PENDING` values, so the
      // writeback would emit "Pending" for every row. The sheetRowByLinkId
      // map is keyed by id which doesn't change, so it stays valid.
      const finalLinks = await this.links.findLinksBySheetsTaskOrdered(sheetsTaskId);
      await this.writeResultsBack(task, sheetTitle, finalLinks, sheetRowByLinkId);

      // 7. Final state
      const final = await this.links.getSheetsProgressCounts(sheetsTaskId);
      const lastRunStatus =
        final.errors === 0 ? `OK · ${final.found}/${total} found` : `${final.errors} errors`;

      await this.links.setSheetsTaskStatus(sheetsTaskId, 'COMPLETED', lastRunStatus);
      const updated = await this.links.findSheetsTaskById(sheetsTaskId);
      await this.publishTaskUpdated(updated ?? task, 'COMPLETED', new Date(), lastRunStatus);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`SheetsTask ${sheetsTaskId} failed: ${reason}`);
      await this.links
        .setSheetsTaskStatus(sheetsTaskId, 'FAILED', reason.slice(0, 500))
        .catch(() => undefined);
      const updated = await this.links.findSheetsTaskById(sheetsTaskId);
      if (updated) {
        await this.publishTaskUpdated(updated, 'FAILED', new Date(), reason.slice(0, 500));
      }
    } finally {
      clearInterval(heartbeat);
      await this.links
        .setProjectSheetsChecking(task.projectId, false)
        .catch(() => undefined);
      await lock.release().catch(() => undefined);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Writeback
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Build a formatted block of cells for the result columns and push it
   * to Google Sheets in a single batchUpdate. We also write a styled
   * header row at task.headerRow and resize the result columns.
   *
   * The `_sheetTitle` parameter is unused now (we address by sheetId/gid
   * via batchUpdate.updateCells), but we keep it on the signature so the
   * caller can pre-resolve gid → title once and use it for any future
   * fallback to A1 range writes.
   */
  private async writeResultsBack(
    task: SheetsTask,
    _sheetTitle: string,
    links: Link[],
    sheetRowByLinkId: Map<string, SheetRow>,
  ): Promise<void> {
    if (links.length === 0) return;

    const rowNumbers = links
      .map((l) => sheetRowByLinkId.get(l.id)?.rowNumber ?? -1)
      .filter((r) => r > 0);
    if (rowNumbers.length === 0) return;

    const minRow = Math.min(...rowNumbers);
    const maxRow = Math.max(...rowNumbers);
    const startColumnIndex = colLetterToIndex(task.resultStartCol);

    // ── Data block ──────────────────────────────────────────────────
    const dataCells: FormattedCell[][] = [];
    for (let r = minRow; r <= maxRow; r++) {
      const link = links.find((l) => sheetRowByLinkId.get(l.id)?.rowNumber === r);
      dataCells.push(link ? buildDataRowCells(link) : Array(RESULT_HEADERS.length).fill({ value: '' }));
    }

    await this.sheetsClient.writeFormattedBlock({
      spreadsheetId: task.spreadsheetId,
      sheetId: task.sheetGid,
      startRowIndex: minRow - 1, // Sheets API is 0-based
      startColumnIndex,
      cells: dataCells,
    });

    // ── Header row ──────────────────────────────────────────────────
    if (task.headerRow > 0) {
      const headerRow: FormattedCell[] = RESULT_HEADERS.map((h) => ({
        value: h,
        bold: true,
        bgColor: COLORS.headerBg,
        textColor: COLORS.headerText,
      }));
      await this.sheetsClient.writeFormattedBlock({
        spreadsheetId: task.spreadsheetId,
        sheetId: task.sheetGid,
        startRowIndex: task.headerRow - 1,
        startColumnIndex,
        cells: [headerRow],
      });
    }

    // ── Column widths (best-effort, swallow errors) ─────────────────
    try {
      await this.sheetsClient.setColumnWidths({
        spreadsheetId: task.spreadsheetId,
        sheetId: task.sheetGid,
        startColumnIndex,
        widths: COLUMN_WIDTHS,
      });
    } catch (err) {
      this.logger.warn(`setColumnWidths failed: ${(err as Error).message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  private async publishTaskUpdated(
    task: SheetsTask,
    status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED',
    lastRunAt: Date | null,
    lastRunStatus: string | null,
  ): Promise<void> {
    await this.publisher.publishNow({
      type: 'sheets_task_updated',
      sheetsTaskId: task.id,
      projectId: task.projectId,
      status,
      lastRunAt: lastRunAt?.toISOString() ?? task.lastRunAt?.toISOString() ?? null,
      lastRunStatus,
    });
  }

  private startHeartbeat(lock: Lock): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const ok = await lock.heartbeat();
        if (!ok) this.logger.error(`Lock heartbeat returned false for ${lock.key}`);
      } catch (err) {
        this.logger.error(`Lock heartbeat error: ${(err as Error).message}`);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────

interface NormalizedRow {
  donorUrl: string;
  acceptor: string;
  acceptorHost: string | null;
  errors: string[];
}

export function normalizeRow(row: SheetRow): NormalizedRow {
  const errors: string[] = [];
  const donorUrl = row.donorUrl.trim();
  const acceptor = row.acceptor.trim();

  if (!donorUrl) errors.push('donor empty');
  else if (!isValidDonorUrl(donorUrl)) errors.push('donor not a valid URL');

  let acceptorHost: string | null = null;
  if (!acceptor) {
    errors.push('acceptor empty');
  } else {
    try {
      acceptorHost = extractAcceptorHost(acceptor);
    } catch (err) {
      errors.push(`acceptor invalid: ${(err as Error).message}`);
    }
  }

  return { donorUrl, acceptor, acceptorHost, errors };
}

const NOFOLLOW_RELS = new Set(['nofollow', 'sponsored', 'ugc']);

function deriveFoundCell(link: Link): string {
  if (link.linkFound !== true) return 'no';
  // Found — distinguish dofollow vs nofollow.
  const occurrences =
    (link.occurrences as Array<{ rel: string[] }> | null | undefined) ?? [];
  const hasDofollow = occurrences.some(
    (o) => !o.rel.some((r) => NOFOLLOW_RELS.has(r.toLowerCase())),
  );
  return hasDofollow ? 'dofollow' : 'nofollow';
}

function deriveCanonicalCell(link: Link): string {
  // Distinguish "no canonical present" (not a problem) from match/mismatch.
  if (link.donorCanonical === null) return 'not found';
  return link.canonicalMatches ? 'match' : 'differs';
}

function formatRow(link: Link): RowResult {
  return {
    status: deriveLabel(link),
    http: link.donorStatusCode ?? '',
    found: deriveFoundCell(link),
    indexable: link.donorIndexable === null ? '' : link.donorIndexable ? 'yes' : 'no',
    canonicalMatch: deriveCanonicalCell(link),
    lastChecked: link.lastCheckedAt?.toISOString() ?? '',
  };
}

function deriveLabel(link: Link): string {
  if (link.status === 'PENDING' || link.status === 'QUEUED') return 'Pending';
  if (link.status === 'CHECKING') return 'Checking';
  if (link.status === 'ERROR') return 'Error';
  // DONE
  const code = link.donorStatusCode;
  const isOk = code != null && code >= 200 && code < 300;
  if (!isOk || link.linkFound !== true || link.donorIndexable !== true) return 'Problem';
  // Pages without a canonical tag flow through here as canonicalMatches=true
  // (parser sets it that way), so they correctly land on "Done".
  return link.canonicalMatches ? 'Done' : 'Done (canonical mismatch)';
}

// ────────────────────────────────────────────────────────────────────────
// Sheets formatting palette
// ────────────────────────────────────────────────────────────────────────

const COLORS = {
  // Status / state
  greenBg: { r: 0.85, g: 0.94, b: 0.84 } as RGB,
  greenText: { r: 0.13, g: 0.45, b: 0.18 } as RGB,
  yellowBg: { r: 1.0, g: 0.95, b: 0.78 } as RGB,
  yellowText: { r: 0.55, g: 0.4, b: 0.04 } as RGB,
  redBg: { r: 0.99, g: 0.86, b: 0.86 } as RGB,
  redText: { r: 0.6, g: 0.06, b: 0.06 } as RGB,
  blueBg: { r: 0.85, g: 0.92, b: 0.99 } as RGB,
  blueText: { r: 0.1, g: 0.31, b: 0.65 } as RGB,
  neutralText: { r: 0.13, g: 0.13, b: 0.13 } as RGB,
  // Header
  headerBg: { r: 0.93, g: 0.93, b: 0.93 } as RGB,
  headerText: { r: 0.13, g: 0.13, b: 0.13 } as RGB,
};

const COLUMN_WIDTHS = [120, 70, 100, 90, 110, 160] as const;

/**
 * Format a single Link into the 6 result cells with colours and weights
 * matching the product spec:
 *
 *   Status:    Done → green; "Done (canonical mismatch)" → yellow; Problem/Error → red
 *   HTTP:      2xx → green text; other → red text
 *   Found:     dofollow → green text on green bg; nofollow → yellow text on green bg;
 *              "no" → red text on red bg
 *   Indexable: yes → green; no → red
 *   Canonical: match → green; differs → yellow; not found → blue
 *   Last checked: neutral text, formatted local timestamp
 */
function buildDataRowCells(link: Link): FormattedCell[] {
  const r = formatRow(link);

  // Status
  let statusBg: RGB = COLORS.greenBg;
  let statusText: RGB = COLORS.greenText;
  if (r.status === 'Done (canonical mismatch)') {
    statusBg = COLORS.yellowBg;
    statusText = COLORS.yellowText;
  } else if (r.status === 'Problem' || r.status === 'Error') {
    statusBg = COLORS.redBg;
    statusText = COLORS.redText;
  } else if (r.status === 'Pending' || r.status === 'Checking') {
    statusBg = COLORS.headerBg;
    statusText = COLORS.neutralText;
  }

  // HTTP
  const httpNum = typeof r.http === 'number' ? r.http : null;
  const httpOk = httpNum != null && httpNum >= 200 && httpNum < 300;
  const httpText = httpNum != null ? COLORS.greenText : COLORS.neutralText;

  // Found
  let foundBg: RGB = COLORS.redBg;
  let foundText: RGB = COLORS.redText;
  if (r.found === 'dofollow') {
    foundBg = COLORS.greenBg;
    foundText = COLORS.greenText;
  } else if (r.found === 'nofollow') {
    foundBg = COLORS.greenBg;
    foundText = COLORS.yellowText;
  }

  // Indexable
  let idxBg: RGB | undefined;
  let idxText: RGB = COLORS.neutralText;
  if (r.indexable === 'yes') {
    idxBg = COLORS.greenBg;
    idxText = COLORS.greenText;
  } else if (r.indexable === 'no') {
    idxBg = COLORS.redBg;
    idxText = COLORS.redText;
  }

  // Canonical
  let canonBg: RGB = COLORS.greenBg;
  let canonText: RGB = COLORS.greenText;
  if (r.canonicalMatch === 'differs') {
    canonBg = COLORS.yellowBg;
    canonText = COLORS.yellowText;
  } else if (r.canonicalMatch === 'not found') {
    canonBg = COLORS.blueBg;
    canonText = COLORS.blueText;
  }

  // Last checked — formatted local timestamp ("YYYY-MM-DD HH:MM")
  const lastCheckedText = link.lastCheckedAt ? formatTimestamp(link.lastCheckedAt) : '';

  return [
    { value: r.status, bgColor: statusBg, textColor: statusText, bold: true },
    {
      value: typeof r.http === 'number' ? r.http : '',
      textColor: httpOk ? COLORS.greenText : httpNum != null ? COLORS.redText : httpText,
      bold: httpNum != null,
    },
    { value: r.found, bgColor: foundBg, textColor: foundText, bold: true },
    { value: r.indexable, bgColor: idxBg, textColor: idxText, bold: true },
    { value: r.canonicalMatch, bgColor: canonBg, textColor: canonText, bold: true },
    { value: lastCheckedText, textColor: COLORS.neutralText },
  ];
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

