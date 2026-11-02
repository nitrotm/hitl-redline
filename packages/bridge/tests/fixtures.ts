import type { FeedbackRound } from '@redline/shared'

// a 1×1 PNG
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export function makeRound(overrides: Partial<FeedbackRound> = {}): FeedbackRound {
  return {
    version: 1,
    sessionId: 'session-1',
    round: 1,
    status: 'feedback',
    comment: 'Overall too cramped.',
    snapshots: [
      {
        id: 'S1',
        url: 'http://localhost:5173/',
        title: 'Home',
        capturedAt: '2026-11-02T10:00:00.000Z',
        viewport: { width: 1280, height: 800, dpr: 2, scrollX: 0, scrollY: 400 },
        images: { clean: PNG, annotated: PNG },
        annotations: [
          {
            id: 1,
            kind: 'rect',
            color: '#e11d48',
            comment: 'Make this button bigger',
            rect: { x: 100, y: 500, width: 200, height: 40 },
            target: { selector: 'main > button.cta', tag: 'button', text: 'Sign up' },
          },
          {
            id: 2,
            kind: 'freehand',
            color: '#e11d48',
            comment: '',
            points: [
              { x: 10, y: 420 },
              { x: 60, y: 480 },
              { x: 30, y: 450 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  }
}
