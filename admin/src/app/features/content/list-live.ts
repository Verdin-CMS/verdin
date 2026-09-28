import { RealtimeMessage } from '../../core/realtime';

/**
 * How an entry event concerns a list page of `uid` in `locale`: `row` when it changed a
 * listed entry, `list` when the page may be outdated (a new entry, or one on another
 * page), `null` when it does not concern the list.
 */
export function listChange(
  message: RealtimeMessage,
  uid: string,
  locale: string | null,
  listed: ReadonlySet<string>,
): 'row' | 'list' | null {
  if (message.uid !== uid || !message.event.startsWith('entry.')) return null;
  // Deletions remove every locale; other events concern the listed locale only.
  if (message.event !== 'entry.delete' && locale && message.locale && message.locale !== locale)
    return null;
  if (message.documentId && listed.has(message.documentId)) return 'row';
  return 'list';
}
