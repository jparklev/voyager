import { mount } from "@vue/test-utils"
import htmlBeautify from "html-beautify"
import NiDataEmpty from "common/NiDataEmpty"

describe("NiDataEmpty", () => {
  let wrapper
  beforeEach(() => {
    wrapper = mount(NiDataEmpty)
  })

  it("has the expected html structure", () => {
    expect(htmlBeautify(wrapper.html())).toMatchSnapshot()
  })

  it("has an icon", () => {
    expect(
      wrapper
        .find(".ni-data-msg__icon i.material-icons")
        .text()
        .trim()
    ).toBe("info_outline")
  })

  it("has a title", () => {
    expect(
      wrapper
        .find(".ni-data-msg__title h4")
        .text()
        .trim()
    ).toBe("N/A")
  })

  it("has a subtitle", () => {
    expect(
      wrapper
        .find(".ni-data-msg__subtitle h5")
        .text()
        .trim()
    ).toBe("No data available yet.")
  })
})
