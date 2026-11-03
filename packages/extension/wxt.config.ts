import { defineConfig } from 'wxt'

// Firefox builds MV2 (WXT's default there): its host permissions are granted at install, which
// MV3 would leave to the user, even for a temporary add-on. Chrome builds MV3, with a key that
// fixes its id (CHROME_EXTENSION_ID), which the native messaging host lets in.
export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'hitl-redline',
    description: 'Draw on a page, comment each mark, and send the screenshots to Claude Code.',
    // nativeMessaging: the user's token, from `redline native-host` (packages/bridge/src/native.ts)
    permissions: ['storage', 'unlimitedStorage', 'scripting', 'tabs', 'alarms', 'nativeMessaging'],
    // every page, to draw on it and capture it; and the loopback, where `redline wait` listens
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Redline: annotate this page', default_icon: icons },
    icons,
    commands: {
      'toggle-redline': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Turn Redline on or off on this tab',
      },
    },
    ...(browser === 'chrome' && { key: CHROME_KEY }),
    ...(browser === 'firefox' && {
      browser_specific_settings: { gecko: { id: 'redline@tmsrv.org', strict_min_version: '128.0' } },
    }),
  }),
})

// the public key only, which is all an unpacked extension needs for its id
const CHROME_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmpewyF6VXLY/u7JIGBr0nlT6O3t/ZGSBbd9FRixfgD5fuzJTbizdKo7sNoVQgdLossIPxrrXRegaBNuiCaVxwkkLZVbVcNwzhAo6vm8LfiGLE+pTsirn9sa8mRylWtBuGmyfnMjnabeH7mWWb5JiMiSLZDsV8UBdnB5NYI8pS1NmVPqDGjjC9pYb0NvZZDqbnPMGRpX+DsyQu0nMrHfPrFXk1kyFm3p8piVh0YrtMA9QW6pjqvsloxrnpg1c4iUmb3q/xgy4QbmOfe6w39ukuxDWa2mOWd6l5ZHIMWQA31VXAIsBc9ug86/EDSxsmbxqDavhCWRHZl3vLbuyVqteGwIDAQAB'

const icons = { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' }
