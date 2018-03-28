import Vue from "vue"
import CardNew from "renderer/components/wallet/CardNew"

describe("CardNew", () => {
  let Cmp, vm
  let propsData = {
    icon: "taco",
    value: 12345678
  }

  beforeEach(() => {
    Cmp = Vue.extend(CardNew)
    vm = new Cmp({ propsData }).$mount()
  })

  it("has the expected html structure", () => {
    expect(vm.$el).toMatchSnapshot()
  })
})
