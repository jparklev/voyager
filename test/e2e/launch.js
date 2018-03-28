"use strict"

let { Application } = require("spectron")
let test = require("tape-promise/tape")
let electron = require("electron")
let { join } = require("path")
let { spawn } = require("child_process")
let fs = require("fs-extra")
let { newTempDir, login } = require("./common.js")

let app, home, cliHome, started
let binary = process.env.BINARY_PATH

function launch(t) {
  if (!started) {
    // tape doesn't exit properly on uncaught promise rejections
    process.on("unhandledRejection", async error => {
      console.error("unhandledRejection", error)
      if (app && app.client) {
        console.log("saving screenshot to ", join(__dirname, "snapshot.png"))
        await app.browserWindow.capturePage().then(function(imageBuffer) {
          fs.writeFileSync(join(__dirname, "snapshot.png"), imageBuffer)
        })
      }
      process.exit(1)
    })

    started = new Promise(async (resolve, reject) => {
      console.log("using binary", binary)

      // TODO cleanup
      home = newTempDir()
      cliHome = join(newTempDir(), "baseserver")
      console.error(`ui home: ${home}`)
      console.error(`node home: ${cliHome}`)

      await startLocalNode()

      app = new Application({
        path: electron,
        args: [
          join(__dirname, "../../app/dist/main.js"),
          "--headless",
          "--disable-gpu",
          "--no-sandbox"
        ],
        startTimeout: 10000,
        waitTimeout: 10000,
        env: {
          ANALYTICS: "false",
          COSMOS_NODE: "localhost",
          NODE_ENV: "production",
          PREVIEW: "true",
          COSMOS_DEVTOOLS: 0, // open devtools will cause issues with spectron, you can open them later manually
          COSMOS_HOME: home,
          COSMOS_NETWORK: "test/e2e/localtestnet"
        }
      })

      await startApp(app)
      t.ok(app.isRunning(), "app is running")

      // test if app restores from unitialized gaia folder
      await app.stop()
      fs.removeSync(join(home, "baseserver"))
      fs.mkdirpSync(join(home, "baseserver"))
      await startApp(app)
      t.ok(app.isRunning(), "app recovers from uninitialized gaia")

      await app.stop()
      await createAccount(
        "testkey",
        "chair govern physical divorce tape movie slam field gloom process pen universe allow pyramid private ability"
      )
      await createAccount(
        "testreceiver",
        "crash ten rug mosquito cart south allow pluck shine island broom deputy hungry photo drift absorb"
      )
      console.log("restored test accounts")
      await startApp(app)
      t.ok(app.isRunning(), "app is running")

      resolve({ app, home })
    })
  }

  return started
}

test.onFinish(() => (app ? app.stop() : null))
test.onFinish(async () => {
  console.log("DONE: cleaning up")
  ;(await app) ? app.stop() : null
  // tape doesn't finish properly because of open processes like gaia
  process.exit(0)
})

function printAppLog(app) {
  app.client.getMainProcessLogs().then(function(logs) {
    logs.forEach(function(log) {
      console.log(log)
    })
  })
  app.client.getRenderProcessLogs().then(function(logs) {
    logs.forEach(function(log) {
      console.log(log.message)
      console.log(log.source)
      console.log(log.level)
    })
  })
}

async function startApp(app) {
  await app.start()

  await app.client.waitForExist(".ni-session", 5000).catch(e => {
    printAppLog(app)
    throw e
  })
}

async function startLocalNode() {
  await new Promise((resolve, reject) => {
    let child = spawn(binary, [
      "node",
      "init",
      "D0718DDFF62D301626B428A182F830CBB0AD21FC",
      "--home",
      cliHome,
      "--chain-id",
      "localtestnet"
    ])
    child.once("exit", code => {
      if (code === 0) resolve()
      reject()
    })
  })
  console.log("inited local node")

  await new Promise((resolve, reject) => {
    // TODO cleanup
    let localnodeProcess = spawn(binary, ["node", "start", "--home", cliHome])
    localnodeProcess.stderr.pipe(process.stderr)
    localnodeProcess.stdout.once("data", data => {
      let msg = data.toString()
      if (!msg.includes("Failed") && !msg.includes("Error")) {
        resolve()
      }
      reject()
    })
    localnodeProcess.once("exit", code => {
      reject()
    })
  })
  console.log("started local node")
}

async function createAccount(name, seed) {
  await new Promise((resolve, reject) => {
    let child = spawn(binary, [
      "client",
      "keys",
      "recover",
      name,
      "--home",
      join(home, "baseserver")
    ])
    child.stdin.write("1234567890\n")
    child.stdin.write(seed + "\n")
    child.stderr.pipe(process.stdout)
    child.once("exit", code => {
      if (code === 0) resolve()
      reject()
    })
  })
}

module.exports = {
  getApp: launch,
  restart: async function(app) {
    console.log("restarting app")
    await app.stop()
    await startApp(app)
  }
}
