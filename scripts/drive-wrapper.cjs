// Temporary driver wrapper: point userData at a throwaway dir so an automated
// launch never touches (or restores) the real config/workspace, then boot the app.
const { app } = require('electron')
const path = require('node:path')
const os = require('node:os')
app.setPath('userData', path.join(os.tmpdir(), 'orbit-drive-userdata'))
require(path.join(__dirname, '..', 'out', 'main', 'index.js'))
