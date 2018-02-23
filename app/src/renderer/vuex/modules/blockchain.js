import axios from 'axios'

export default ({ commit, node }) => {
  const state = {
    urlPrefix: 'https://',
    blockchainName: 'gaia-2',
    urlSuffix: '-node0.testnets.interblock.io',
    status: {},
    abciInfo: {},
    blocks: [],
    block: {},
    blockHeight: null, // we remember the height so we can requery the block, if querying failed
    blockLoading: false,
    url: ''
  }

  let url = state.urlPrefix + state.blockchainName + state.urlSuffix
  const mutations = {
    setUrl (state) {
      state.url = url
    },
    getStatus (state) {
      axios(url + '/status').then((res) => {
        state.status = res.data.result
      })
    },
    getAbciInfo (state) {
      axios(url + '/abci_info').then((res) => {
        state.abciInfo = res.data.result
      })
    },
    setBlock (state, block) {
      state.block = block
    }
  }

  const actions = {
    reconnected ({ state, dispatch }) {
      if (state.blockLoading) {
        dispatch('getBlock', state.blockHeight)
      }
    },
    async getBlock ({ state, commit }, height) {
      state.blockLoading = true
      state.blockHeight = height
      const blockUrl = url + '/block?height=' + height
      let block = (await axios.get(blockUrl)).data.result
      commit('setBlock', block)
      state.blockLoading = false
    }
  }

  function subscribe () {
    node.rpc.subscribe({ query: "tm.event = 'NewBlock'" }, (err, event) => {
      if (err) return console.error('error subscribing to new block headers', err)

      state.blocks.unshift(event.data.data.block)

      if (state.blocks.length === 20) {
        state.blocks.pop()
      }
    })
  }
  subscribe()

  setTimeout(() => {
    mutations.getStatus(state)
    mutations.getAbciInfo(state)
    mutations.setUrl(state)
  }, 3000)

  return { state, mutations, actions }
}
