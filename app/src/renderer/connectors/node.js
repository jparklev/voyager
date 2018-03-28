"use strict"
const RestClient = require("./lcdClient.js")
const mockedRestClient = require("./lcdClientMock.js")
const RpcWrapper = require("./rpcWrapper.js")
const mockedRpcWrapper = require("./rpcWrapperMock.js")

module.exports = function(nodeIP, relayPort, mocked = false) {
  const RELAY_SERVER = "http://localhost:" + relayPort

  let connector = {
    relayPort,
    // activate or deactivate the mocked lcdClient
    setMocked: mocked => {
      let newRestClient = mocked
        ? mockedRestClient
        : new RestClient(RELAY_SERVER)
      let newRpcClient = mocked
        ? mockedRpcWrapper(connector)
        : RpcWrapper(connector, nodeIP, RELAY_SERVER)
      Object.assign(connector, newRestClient, newRpcClient)
      // we can't assign class functions to an object so we need to iterate over the prototype
      if (!mocked) {
        Object.getOwnPropertyNames(
          Object.getPrototypeOf(newRestClient)
        ).forEach(prop => {
          connector[prop] = newRestClient[prop]
        })
      }
    }
  }
  // TODO: eventually, get all data from light-client connection instead of RPC

  connector.setMocked(mocked)
  connector.initRPC(nodeIP)
  return connector
}
