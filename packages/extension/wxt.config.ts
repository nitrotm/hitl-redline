import { defineConfig } from 'wxt'

// Firefox builds MV2 (WXT's default there): its host permissions are granted at install, which
// MV3 would leave to the user, even for a temporary add-on. Chrome builds MV3.
export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Redline',
    description: 'Draw on a page, comment each mark, and send the screenshots to Claude Code.',
    permissions: ['storage', 'unlimitedStorage', 'scripting', 'tabs', 'alarms'],
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
    ...(browser === 'firefox' && {
      browser_specific_settings: { gecko: { id: 'redline@firefox-redline', strict_min_version: '128.0' } },
    }),
  }),
})

const icons = { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' }
