/**
 * @fileoverview src/lib/audio/playbackAction.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export interface AudioPlaybackController {
  pause(): void;
  replace(source: { uri: string }): void;
  play(): void;
  seekTo(position: number): void | Promise<void>;
}

export interface AudioPlaybackActionInput {
  player: AudioPlaybackController;
  playbackUri: string;
  loadedUri: string | null;
  isPlaying: boolean;
  didJustFinish: boolean;
}

/** Executes the exact side effects behind a card-audio click. */
export async function performAudioPlaybackAction(input: AudioPlaybackActionInput): Promise<string | null> {
  try {
    if (!input.playbackUri) throw new Error('Invalid audio source.');
    if (input.isPlaying) {
      input.player.pause();
      return input.loadedUri;
    }
    if (input.loadedUri !== input.playbackUri) {
      input.player.replace({ uri: input.playbackUri });
    } else if (input.didJustFinish) {
      await input.player.seekTo(0);
    }
    input.player.play();
    return input.playbackUri;
  } catch (error) {
    try {
      input.player.pause();
    } catch {
      // The original playback failure remains the actionable error.
    }
    throw error;
  }
}
