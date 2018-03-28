import setup from "../../../helpers/vuex-setup"
import htmlBeautify from "html-beautify"
import PageBlocks from "renderer/components/monitor/PageBlocks"

describe("PageBlocks", () => {
  let wrapper, store
  let { mount } = setup()

  let block = {
    header: {
      last_block_id: {
        hash: "last-hash",
        parts: { total: 0 }
      },
      num_txs: 0,
      height: 10,
      time: 1608
    },
    last_commit: { precommits: [] },
    data: { txs: 0 }
  }

  beforeEach(() => {
    let instance = mount(PageBlocks, {
      stubs: { "modal-search": "<modal-search />" },
      getters: {
        lastHeader: () => ({
          time: 1608,
          last_block_id: { hash: "123" },
          height: 12345
        }),
        blockchain: () => ({
          blocks: [block],
          block,
          blockMetaInfo: { block_id: { hash: "hash" } },
          blockHeight: null,
          blockLoading: false,
          subscription: true,
          blockMetas: []
        })
      }
    })
    wrapper = instance.wrapper
    store = instance.store

    wrapper.update()
  })

  it("has the expected html structure", () => {
    expect(htmlBeautify(wrapper.html())).toMatchSnapshot()
  })

  it("should call resetSearch on beforeDestroy", () => {
    wrapper.destroy()
    expect(store.commit).toHaveBeenCalledWith("resetSearch", "blocks")
  })

  it("should show the search on click", () => {
    wrapper.vm.setSearch(true)
    expect(store.commit).toHaveBeenCalledWith("setSearchVisible", [
      "blocks",
      true
    ])
  })
})
