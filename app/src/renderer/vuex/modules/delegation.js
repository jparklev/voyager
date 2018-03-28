export default ({ commit, node }) => {
  let state = {
    loading: false,
    delegationActive: false,

    // our delegations, maybe not yet committed
    delegates: [],

    // our delegations which are already on the blockchain
    committedDelegates: {}
  }

  const mutations = {
    activateDelegation(state) {
      state.delegationActive = true
    },
    addToCart(state, delegate) {
      // don't add to cart if already in cart
      for (let existingDelegate of state.delegates) {
        if (delegate.id === existingDelegate.id) return
      }

      state.delegates.push({
        id: delegate.id,
        delegate: Object.assign({}, delegate),
        atoms: 0
      })
    },
    removeFromCart(state, delegate) {
      state.delegates = state.delegates.filter(c => c.id !== delegate)
    },
    setShares(state, { candidateId, value }) {
      state.delegates.find(c => c.id === candidateId).atoms = value
    },
    setCommittedDelegation(state, { candidateId, value }) {
      let committedDelegates = Object.assign({}, state.committedDelegates)
      if (value === 0) {
        delete committedDelegates[candidateId]
      } else {
        committedDelegates[candidateId] = value
      }
      state.committedDelegates = committedDelegates
    }
  }

  let actions = {
    reconnected({ state, dispatch }) {
      if (state.loading) {
        dispatch("getBondedDelegates")
      }
    },
    // load committed delegations from LCD
    async getBondedDelegates({ state, rootState, dispatch }, candidates) {
      state.loading = true
      let address = rootState.user.address
      candidates = candidates || (await dispatch("getDelegates"))
      await Promise.all(
        candidates.map(candidate =>
          dispatch("getBondedDelegate", {
            address,
            pubkey: candidate.pub_key.data
          })
        )
      )
      state.loading = false
    },
    // load committed delegation from LCD
    async getBondedDelegate({ commit }, { address, pubkey }) {
      let bond = (await node.bondingsByDelegator([address, pubkey])).data
      commit("setCommittedDelegation", {
        candidateId: bond.PubKey.data,
        value: bond.Shares
      })
    },
    walletDelegate({ dispatch }, args) {
      args.type = "buildDelegate"
      return dispatch("sendTx", args)
    },
    walletUnbond({ dispatch }, args) {
      args.type = "buildUnbond"
      return dispatch("sendTx", args)
    },
    submitDelegation({ state, dispatch }, delegation) {
      return Promise.all(
        delegation.delegates
          .map(delegation => {
            let candidateId = delegation.delegate.pub_key.data
            let currentlyDelegated = state.committedDelegates[candidateId] || 0
            let amountChange = delegation.atoms - currentlyDelegated
            let action = amountChange > 0 ? "walletDelegate" : "walletUnbond"

            // skip if no change
            if (amountChange === 0) return null

            // bonding takes a 'coin' object, unbond just takes a number
            let amount
            if (amountChange > 0) {
              // TODO: figure out which denom is bonding denom
              amount = { denom: "fermion", amount: Math.abs(amountChange) }
            } else {
              amount = Math.abs(amountChange)
            }

            return dispatch(action, {
              amount,
              pub_key: delegation.delegate.pub_key
            })
          })
          .filter(x => x !== null)
      )
    }
  }

  return {
    state,
    mutations,
    actions
  }
}
