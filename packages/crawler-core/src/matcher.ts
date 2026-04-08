import { extractAcceptorHost } from '@link-checker/shared';

/**
 * Thin wrapper exposing the matcher used by workers/UI.
 *
 * Matching policy: exact normalized host equality. No subdomain magic.
 *
 *   acceptor "studibucht.de"      matches only host "studibucht.de"
 *   acceptor "blog.studibucht.de" matches only host "blog.studibucht.de"
 */
export function normalizeAcceptor(input: string): string {
  return extractAcceptorHost(input);
}
