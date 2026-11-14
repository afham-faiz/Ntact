/**
 * Plain-language wording for the physical device link.
 *
 * Nothing here shows a UUID, an error name or a raw firmware message: those live
 * in the developer panel on the demo controls page.
 */
import type { DeviceContextValue, LinkProblem } from '../../app/DeviceContext';
import { BLE_PROFILE } from '../../domain/firmware';

/** The name the browser's device list shows for the wearable. The firmware has not been renamed. */
export const LISTED_NAME = BLE_PROFILE.advertisedName;

export const PROBLEM_COPY: Record<LinkProblem, { title: string; body: string }> = {
  lost: {
    title: 'Connection lost. Reconnect to continue.',
    body: 'The wearable goes idle when the connection drops, so it gives no feedback until you reconnect and choose a mode. A test that was running was cancelled and nothing was saved.',
  },
  unsupported: {
    title: 'This browser can’t connect to the wearable',
    body: 'Open Ntact in Chrome or Edge on a Windows laptop, or in Chrome on an Android phone. iPhone and iPad browsers can’t use Bluetooth from a web page. You can carry on in demonstration mode.',
  },
  insecure: {
    title: 'Bluetooth needs the secure address',
    body: 'Browsers only allow Bluetooth on an https:// address, or on localhost on the development laptop. Open Ntact from its https:// link, or carry on in demonstration mode.',
  },
  'bluetooth-off': {
    title: 'Bluetooth is switched off',
    body: 'Turn on Bluetooth on this computer, then connect again.',
  },
  cancelled: {
    title: 'No device was chosen',
    body: `Connect again and pick ${LISTED_NAME} from the list. If it isn’t listed, check the wearable is switched on and close by.`,
  },
  permission: {
    title: 'Bluetooth was blocked for this page',
    body: 'Allow Bluetooth for this site in the browser’s site settings (the icon beside the address), then connect again.',
  },
  unreachable: {
    title: 'Couldn’t reach the wearable',
    body: 'Check it is switched on and within a metre or two. If another phone or app is connected to it, disconnect that first: the wearable accepts one connection at a time.',
  },
  timeout: {
    title: 'The wearable didn’t answer in time',
    body: 'Move closer, switch the wearable off and on again, then connect again.',
  },
  'service-missing': {
    title: 'That device isn’t answering as an Ntact wearable',
    body: 'It connected, but the expected controls weren’t found. It may be a different device, or running different firmware. The developer panel has the details.',
  },
  failed: {
    title: 'The connection didn’t go through',
    body: 'Connect again. If it keeps happening, switch the wearable off and on, and check the developer panel.',
  },
};

/** One line for the top of the device card. */
export function linkHeadline(device: Pick<DeviceContextValue, 'simulated' | 'connection' | 'stage' | 'problem'>): string {
  if (device.simulated) {
    return `Demo device ${device.connection === 'connecting' ? 'connecting' : device.connection === 'connected' ? 'connected' : 'disconnected'}`;
  }
  if (device.connection === 'connected') return 'Connected';
  if (device.connection === 'connecting') {
    return device.stage === 'choosing' ? 'Searching for nearby devices' : 'Connecting';
  }
  if (device.problem === 'lost') return 'Connection lost. Reconnect to continue.';
  return 'Connect your Ntact device';
}

/** Short link state for pills and footers: "Demo device · Connected". */
export function linkSummary(device: Pick<DeviceContextValue, 'simulated' | 'connection' | 'words'>): string {
  const state =
    device.connection === 'connecting' ? 'Connecting' : device.connection === 'connected' ? 'Connected' : device.simulated ? 'Disconnected' : 'Not connected';
  return `${device.words.Name} · ${state}`;
}
