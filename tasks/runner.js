"use strict"

const config = require("../config")
const spawn = require("child_process").spawn
const path = require("path")
const { cleanExitChild } = require("./common.js")

let YELLOW = "\x1b[33m"
let BLUE = "\x1b[34m"
let END = "\x1b[0m"

let NPM_BIN = path.join(path.dirname(__dirname), "node_modules", ".bin")
let PATH = `${NPM_BIN}:${process.env.PATH}`

function format(command, data, color) {
  return (
    color +
    command +
    END +
    "  " + // Two space offset
    data
      .toString()
      .trim()
      .replace(/\n/g, "\n" + " ".repeat(command.length + 2)) +
    "\n"
  )
}

function run(command, color, name, env) {
  env = Object.assign({ PATH }, env)
  let child = spawn(command, { env, shell: true })
  child.stdout.on("data", data => {
    console.log(format(name, data, color))
  })
  child.stderr.on("data", data => {
    console.error(format(name, data, color))
  })
  child.on("exit", code => {
    console.log("exited", command, code)
  })
  return child
}

function startRendererServer() {
  return new Promise(resolve => {
    console.log(`${YELLOW}Starting webpack-dev-server...\n${END}`)
    let child = run(
      `webpack-dev-server --hot --colors --config webpack.renderer.config.js --port ${
        config.wds_port
      } --content-base app/dist`,
      YELLOW,
      "webpack"
    )
    let waitForCompile = data => {
      if (!data.toString().includes("Compiled")) return
      child.stdout.removeListener("data", waitForCompile)
      resolve(child)
    }
    child.stdout.on("data", waitForCompile)
  })
}

module.exports = async function(networkPath) {
  let renderProcess = await startRendererServer()

  console.log(
    `${BLUE}Starting electron...\n  (network path: ${networkPath})\n${END}`
  )
  let env = Object.assign(
    {},
    {
      NODE_ENV: "development",
      COSMOS_NETWORK: networkPath
    },
    process.env
  )
  let mainProcess = run(
    "electron app/src/main/index.dev.js",
    BLUE,
    "electron",
    env
  )

  // terminate running processes on exit of main process
  mainProcess.on("exit", async code => {
    await cleanExitChild(renderProcess)
    // webpack-dev-server spins up an own process we have no access to. so we kill all processes on our port
    process.exit(0)
  })
}
