"use strict"

let { app, BrowserWindow } = require("electron")
let fs = require("fs-extra")
let { join } = require("path")
let { spawn } = require("child_process")
let home = require("user-home")
let semver = require("semver")
// this dependency is wrapped in a file as it was not possible to mock the import with jest any other way
let event = require("event-to-promise")
let toml = require("toml")
let axios = require("axios")
let Raven = require("raven")

let pkg = require("../../../package.json")
let relayServer = require("./relayServer.js")
let addMenu = require("./menu.js")
let config = require("../../../config.js")

let started = false
let shuttingDown = false
let mainWindow
let baseserverProcess
let streams = []
let nodeIP
let connecting = false

const root = require("../root.js")
const networkPath = require("../network.js").path

const baseserverHome = join(root, "baseserver")
const WIN = /^win/.test(process.platform)
const DEV = process.env.NODE_ENV === "development"
const TEST = process.env.NODE_ENV === "testing"
// TODO default logging or default disable logging?
const LOGGING = JSON.parse(process.env.LOGGING || "true") !== false
const MOCK = JSON.parse(process.env.MOCK || DEV) !== false
const winURL = DEV
  ? `http://localhost:${config.wds_port}`
  : `file://${__dirname}/index.html`
const RELAY_PORT = DEV ? config.relay_port : config.relay_port_prod
const LCD_PORT = DEV ? config.lcd_port : config.lcd_port_prod
const NODE = process.env.COSMOS_NODE
const ANALYTICS = process.env.COSMOS_ANALYTICS
  ? JSON.parse(process.env.COSMOS_ANALYTICS)
  : process.env.NODE_ENV === "production" &&
    config.analytics_networks.indexOf(config.default_network) !== -1
// set analytics for renderer
process.env.COSMOS_ANALYTICS = ANALYTICS

let SERVER_BINARY = "gaia" + (WIN ? ".exe" : "")

function log(...args) {
  if (LOGGING) {
    console.log(...args)
  }
}
function logError(...args) {
  if (LOGGING) {
    console.log(...args)
  }
}

function logProcess(process, logPath) {
  fs.ensureFileSync(logPath)
  // Writestreams are blocking fs cleanup in tests, if you get errors, disable logging
  if (LOGGING) {
    let logStream = fs.createWriteStream(logPath, { flags: "a" }) // 'a' means appending (old data will be preserved)
    streams.push(logStream)
    process.stdout.pipe(logStream)
    process.stderr.pipe(logStream)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function expectCleanExit(process, errorMessage = "Process exited unplanned") {
  return new Promise((resolve, reject) => {
    process.on("exit", code => {
      if (code !== 0 && !shuttingDown) {
        throw new Error(errorMessage)
      }
      resolve()
    })
  })
}

function handleCrash(error) {
  mainWindow.loadURL(winURL + "?node=" + nodeIP + "&error=" + error.message)
}

function shutdown() {
  if (shuttingDown) return

  mainWindow = null
  shuttingDown = true

  if (baseserverProcess) {
    log("killing baseserver")
    baseserverProcess.kill("SIGKILL")
    baseserverProcess = null
  }

  return Promise.all(
    streams.map(stream => new Promise(resolve => stream.close(resolve)))
  )
}

function startVueApp() {
  mainWindow.loadURL(winURL + "?node=" + nodeIP + "&relay_port=" + RELAY_PORT)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    minWidth: 320,
    minHeight: 480,
    width: 1024,
    height: 768,
    center: true,
    title: "Cosmos Voyager",
    darkTheme: true,
    titleBarStyle: "hidden",
    webPreferences: { webSecurity: false }
  })

  if (!started) {
    mainWindow.loadURL(winURL)
  } else {
    startVueApp()
  }
  if (DEV || JSON.parse(process.env.COSMOS_DEVTOOLS || "false")) {
    mainWindow.webContents.openDevTools()
  }

  if (DEV) {
    mainWindow.maximize()
  }

  mainWindow.on("closed", shutdown)

  // eslint-disable-next-line no-console
  log("mainWindow opened")

  // handle opening external links in OS's browser
  let webContents = mainWindow.webContents
  let handleRedirect = (e, url) => {
    if (url !== webContents.getURL()) {
      e.preventDefault()
      require("electron").shell.openExternal(url)
    }
  }
  webContents.on("will-navigate", handleRedirect)
  webContents.on("new-window", handleRedirect)

  if (!WIN) addMenu()
}

function startProcess(name, args, env) {
  let binPath
  if (process.env.BINARY_PATH) {
    binPath = process.env.BINARY_PATH
  } else if (DEV) {
    // in dev mode or tests, use binaries installed in GOPATH
    let GOPATH = process.env.GOPATH
    if (!GOPATH) GOPATH = join(home, "go")
    binPath = join(GOPATH, "bin", name)
  } else {
    // in production mode, use binaries packaged with app
    binPath = join(__dirname, "..", "bin", name)
  }

  let argString = args.map(arg => JSON.stringify(arg)).join(" ")
  log(`spawning ${binPath} with args "${argString}"`)
  let child
  try {
    child = spawn(binPath, args, env)
  } catch (err) {
    log(`Err: Spawning ${name} failed`, err)
    throw err
  }
  child.stdout.on("data", data => !shuttingDown && log(`${name}: ${data}`))
  child.stderr.on("data", data => !shuttingDown && log(`${name}: ${data}`))
  child.on(
    "exit",
    code => !shuttingDown && log(`${name} exited with code ${code}`)
  )
  child.on("error", async function(err) {
    if (!(shuttingDown && err.code === "ECONNRESET")) {
      await new Promise(resolve => Raven.captureException(err, resolve))
      // if we throw errors here, they are not handled by the main process
      console.error(
        "[Uncaught Exception] Child",
        name,
        "produced an unhandled exception:",
        err
      )
      handleCrash(err)
    }
  })
  return child
}

app.on("window-all-closed", () => {
  app.quit()
})

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow()
  }
})

app.on("ready", () => createWindow())

// start baseserver REST API
async function startBaseserver(home, nodeIP) {
  log("startBaseserver", home)
  let child = startProcess(SERVER_BINARY, [
    "rest-server",
    "--port",
    LCD_PORT,
    "--home",
    home,
    "--node",
    nodeIP
    // '--trust-node'
  ])
  logProcess(child, join(home, "baseserver.log"))

  while (true) {
    if (shuttingDown) break

    let data = await event(child.stderr, "data")
    if (data.toString().includes("Serving on")) break
  }

  return child
}

async function getGaiaVersion() {
  let child = startProcess(SERVER_BINARY, ["version"])
  let data = await new Promise(resolve => {
    child.stdout.on("data", resolve)
  })
  return data.toString("utf8").trim()
}

function exists(path) {
  try {
    fs.accessSync(path)
    return true
  } catch (err) {
    if (err.code !== "ENOENT") throw err
    return false
  }
}

async function initBaseserver(chainId, home, node) {
  // fs.ensureDirSync(home)
  // `baseserver init` to generate config, trust seed
  let child = startProcess(SERVER_BINARY, [
    "client",
    "init",
    "--home",
    home,
    "--chain-id",
    chainId,
    "--node",
    node
    // '--trust-node'
  ])
  child.stdout.on("data", data => {
    let hashMatch = /\w{40}/g.exec(data)
    if (hashMatch) {
      log("approving hash", hashMatch[0])
      if (shuttingDown) return
      // answer 'y' to the prompt about trust seed. we can trust this is correct
      // since the baseserver is talking to our own full node
      child.stdin.write("y\n")
    }
  })
  await expectCleanExit(child, "gaia init exited unplanned")
}

/*
* log to file
*/
function setupLogging(root) {
  if (!LOGGING) return

  // initialize log file
  let logFilePath = join(root, "main.log")
  fs.ensureFileSync(logFilePath)
  let mainLog = fs.createWriteStream(logFilePath, { flags: "a" }) // 'a' means appending (old data will be preserved)
  mainLog.write(`${new Date()} Running Cosmos-UI\r\n`)
  // mainLog.write(`${new Date()} Environment: ${JSON.stringify(process.env)}\r\n`) // TODO should be filtered before adding it to the log
  streams.push(mainLog)

  log("Redirecting console output to logfile", logFilePath)
  // redirect stdout/err to logfile
  // TODO overwriting console.log sounds like a bad idea, can we find an alternative?
  // eslint-disable-next-line no-func-assign
  log = function(...args) {
    if (DEV) {
      console.log(...args)
    }
    mainLog.write(`main-process: ${args.join(" ")}\r\n`)
  }
  // eslint-disable-next-line no-func-assign
  logError = function(...args) {
    if (DEV) {
      console.error(...args)
    }
    mainLog.write(`main-process: ${args.join(" ")}\r\n`)
  }
}

if (!TEST) {
  process.on("exit", shutdown)
  // on uncaught exceptions we wait so the sentry event can be sent
  process.on("uncaughtException", async function(err) {
    await sleep(1000)
    logError("[Uncaught Exception]", err)
    await new Promise(resolve => Raven.captureException(err, resolve))
    handleCrash(err)
  })
  process.on("unhandledRejection", async function(err) {
    await sleep(1000)
    logError("[Unhandled Promise Rejection]", err)
    await new Promise(resolve => Raven.captureException(err, resolve))
    handleCrash(err)
  })
}

function consistentConfigDir(
  appVersionPath,
  genesisPath,
  configPath,
  gaiaVersionPath
) {
  return (
    exists(genesisPath) &&
    exists(appVersionPath) &&
    exists(configPath) &&
    exists(gaiaVersionPath)
  )
}

// check if baseserver is initialized as the configs could be corrupted
// we need to parse the error on initialization as there is no way to just get this status programmatically
function baseserverInitialized(home) {
  log("Testing if baseserver is already initialized")
  return new Promise((resolve, reject) => {
    let child = startProcess(SERVER_BINARY, [
      "client",
      "init",
      "--home",
      home
      // '--trust-node'
    ])
    child.stderr.on("data", data => {
      if (data.toString().includes("already is initialized")) {
        return resolve(true)
      }
      if (data.toString().includes('"--chain-id" required')) {
        return resolve(false)
      }
      reject("Unknown state for Gaia initialization: " + data.toString())
    })
  })
}

function pickNode(seeds) {
  let nodeIP = NODE || seeds[Math.floor(Math.random() * seeds.length)]
  // let nodeRegex = /([http[s]:\/\/]())/g
  log("Picked seed:", nodeIP, "of", seeds)
  // replace port with default RPC port
  nodeIP = `${nodeIP.split(":")[0]}:46657`

  return nodeIP
}

async function connect(seeds, nodeIP) {
  log(`starting gaia server with nodeIP ${nodeIP}`)
  baseserverProcess = await startBaseserver(baseserverHome, nodeIP)
  log("gaia server ready")

  return nodeIP
}

async function reconnect(seeds) {
  if (connecting) return
  connecting = true

  let nodeAlive = false
  while (!nodeAlive) {
    let nodeIP = pickNode(seeds)
    nodeAlive = await axios("http://" + nodeIP, { timeout: 3000 }).then(
      () => true,
      () => false
    )
    log(
      `${new Date().toLocaleTimeString()} ${nodeIP} is ${
        nodeAlive ? "alive" : "down"
      }`
    )

    if (!nodeAlive) await sleep(2000)
  }

  log("quitting running baseserver")
  baseserverProcess.kill("SIGKILL")

  await connect(seeds, nodeIP)

  connecting = false

  return nodeIP
}

function setupAnalytics() {
  if (ANALYTICS) {
    log("Adding analytics")
  }

  // only enable sending of error events in production setups and if the network is a testnet
  Raven.config(ANALYTICS ? config.sentry_dsn : "", {
    captureUnhandledRejections: false
  }).install()
}

async function main() {
  setupAnalytics()

  let appVersionPath = join(root, "app_version")
  let genesisPath = join(root, "genesis.json")
  let configPath = join(root, "config.toml")
  let gaiaVersionPath = join(root, "gaiaversion.txt")

  let rootExists = exists(root)
  await fs.ensureDir(root)

  setupLogging(root)

  let init = true
  if (rootExists) {
    log(`root exists (${root})`)

    // NOTE: when changing this code, always make sure the app can never
    // overwrite/delete existing data without at least backing it up,
    // since it may contain the user's private keys and they might not
    // have written down their seed words.
    // they might get pretty mad if the app deletes their money!

    // check if the existing data came from a compatible app version
    // if not, fail with an error
    if (
      consistentConfigDir(
        appVersionPath,
        genesisPath,
        configPath,
        gaiaVersionPath
      )
    ) {
      let existingVersion = fs.readFileSync(appVersionPath, "utf8").trim()
      let compatible = semver.diff(existingVersion, pkg.version) !== "major"
      if (compatible) {
        log("configs are compatible with current app version")
        init = false
      } else {
        // TODO: versions of the app with different data formats will need to learn how to
        // migrate old data
        throw Error(`Data was created with an incompatible app version
        data=${existingVersion} app=${pkg.version}`)
      }
    } else {
      throw Error(`The data directory (${root}) has missing files`)
    }

    // check to make sure the genesis.json we want to use matches the one
    // we already have. if it has changed, exit with an error
    if (!init) {
      let existingGenesis = fs.readFileSync(genesisPath, "utf8")
      let genesisJSON = JSON.parse(existingGenesis)
      // skip this check for local testnet
      if (genesisJSON.chain_id !== "local") {
        let specifiedGenesis = fs.readFileSync(
          join(networkPath, "genesis.json"),
          "utf8"
        )
        if (existingGenesis.trim() !== specifiedGenesis.trim()) {
          throw Error("Genesis has changed")
        }
      }
    }
  }

  if (init) {
    log(`initializing data directory (${root})`)
    await fs.ensureDir(root)

    // copy predefined genesis.json and config.toml into root
    fs.accessSync(networkPath) // crash if invalid path
    fs.copySync(networkPath, root)

    fs.writeFileSync(appVersionPath, pkg.version)
  }

  log("starting app")
  log(`dev mode: ${DEV}`)
  log(`winURL: ${winURL}`)

  let gaiaVersion = await getGaiaVersion()
  let expectedGaiaVersion = fs.readFileSync(gaiaVersionPath, "utf8").trim()
  log(`gaia version: "${gaiaVersion}", expected: "${expectedGaiaVersion}"`)
  // TODO: semver check, or exact match?
  if (gaiaVersion !== expectedGaiaVersion) {
    throw Error(`Requires gaia ${expectedGaiaVersion}, but got ${gaiaVersion}.
    Please update your gaia installation or build with a newer binary.`)
  }

  // read chainId from genesis.json
  let genesisText = fs.readFileSync(genesisPath, "utf8")
  let genesis = JSON.parse(genesisText)
  let chainId = genesis.chain_id

  // pick a random seed node from config.toml
  // TODO: user-specified nodes, support switching?
  let configText
  try {
    configText = fs.readFileSync(configPath, "utf8")
  } catch (e) {
    throw new Error(`Can't open config.toml: ${e.message}`)
  }
  let configTOML = toml.parse(configText)
  let seeds = configTOML.p2p.seeds.split(",").filter(x => x !== "")
  if (seeds.length === 0) {
    throw new Error("No seeds specified in config.toml")
  }
  nodeIP = pickNode(seeds)

  let _baseserverInitialized = await baseserverInitialized(
    join(root, "baseserver")
  )
  console.log(
    "Baseserver is",
    _baseserverInitialized ? "" : "not",
    "initialized"
  )
  if (init || !_baseserverInitialized) {
    log(`Trying to initialize baseserver with remote node ${nodeIP}`)
    await initBaseserver(chainId, baseserverHome, nodeIP)
  }

  await connect(seeds, nodeIP)

  // the view can communicate with the main process by sending requests to the relay server
  // the relay server also proxies to the LCD
  relayServer({
    lcdPort: LCD_PORT,
    relayServerPort: RELAY_PORT,
    mock: MOCK,
    onSuccesfulStart: () => {
      console.log("[START SUCCESS] Vue app successfuly started")
    },
    onReconnectReq: reconnect.bind(this, seeds)
  })

  started = true
  if (mainWindow) {
    startVueApp()
  }
}
module.exports = Object.assign(
  main()
    .catch(err => {
      logError(err)
      handleCrash(err)
    })
    .then(() => ({
      shutdown,
      processes: { baseserverProcess },
      analytics: ANALYTICS
    }))
)
