/**
 * The live physio session against a pretend camera.
 *
 * The camera, the video element's playback and the hand-tracking model are all
 * stand-ins here, so this says nothing about real tracking. What it does pin down
 * is the life cycle: the camera is asked for when a session starts, switched off
 * when it ends, and asked for AGAIN when the person presses "Go again".
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoStore } from '../src/demo/store';
import { ExerciseSessionScreen } from '../src/features/patient/ExerciseScreen';

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  HandLandmarker: {
    createFromOptions: async () => ({
      // No hand in view: the session stays at "hold your hand up", which is all this test needs.
      detectForVideo: () => ({ landmarks: [], worldLandmarks: [] }),
      close: () => undefined,
    }),
  },
}));

const stopTrack = vi.fn();
const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));

function mount(path = '/patient/exercise/open-close/live') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/patient/exercise/:exerciseId/live" element={<ExerciseSessionScreen />} />
        <Route path="/patient/exercise" element={<p>Physio list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The session is live once its Stop button can be pressed. */
async function live(): Promise<HTMLElement> {
  const stop = await screen.findByRole('button', { name: 'Stop' });
  await waitFor(() => expect(stop).toBeEnabled());
  return stop;
}

beforeEach(() => {
  demoStore.reset('default');
  stopTrack.mockClear();
  getUserMedia.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  // jsdom has no media playback and no canvas.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('live session and the camera', () => {
  it('asks for the camera once when the session opens', async () => {
    mount();
    await live();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Camera')).toBeInTheDocument();
    expect(screen.getByText('Hold your hand up to the camera')).toBeInTheDocument();
  });

  it('switches the camera off when the session is stopped', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await live());

    expect(await screen.findByText('Nothing was counted this time.')).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('brings the camera back when “Go again” is pressed', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await live());
    await screen.findByText('Nothing was counted this time.');
    const tracksStopped = stopTrack.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Go again' }));

    // A second request for the camera, and a session that is live again rather than stuck on "Starting".
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await live();
    expect(screen.queryByText('Starting the camera')).toBeNull();
    expect(screen.queryByText('Nothing was counted this time.')).toBeNull();
    expect(stopTrack.mock.calls.length).toBe(tracksStopped);
  });

  it('can go round more than once', async () => {
    const user = userEvent.setup();
    mount();
    for (let round = 1; round <= 3; round += 1) {
      await user.click(await live());
      await screen.findByText('Nothing was counted this time.');
      expect(getUserMedia).toHaveBeenCalledTimes(round);
      await user.click(screen.getByRole('button', { name: 'Go again' }));
    }
    await live();
    expect(getUserMedia).toHaveBeenCalledTimes(4);
  });

  it('says so, and offers the demonstration, when the camera is refused', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    mount();

    expect(await screen.findByText('The camera was blocked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Watch a demonstration instead' })).toHaveAttribute(
      'href',
      '/patient/exercise/open-close/live?mode=demo',
    );
    // Trying again asks for the camera a second time.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await live();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('turns the camera off when the person leaves the screen', async () => {
    const user = userEvent.setup();
    mount();
    await live();
    await user.click(screen.getByRole('button', { name: 'Close the exercise' }));

    expect(await screen.findByText('Physio list')).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });
});
