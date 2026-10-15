/** Session-only skip list so leaving Calls and coming back doesn't reshuffle the day. */

let skipped: string[] = []

export function readSkippedCalls(): string[] {
  return skipped
}

export function writeSkippedCalls(next: string[]): void {
  skipped = next
}
