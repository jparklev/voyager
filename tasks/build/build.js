'use strict'

const { cli } = require(`@nodeguy/cli`)
const options = require(`./options.json`)
const path = require(`path`)
const shell = require(`shelljs`)
const untildify = require(`untildify`)

cli(options, async ({ commit, gaia, platform, 'skip-pack': skipPack }) => {
  shell.exec(`docker build --tag cosmos/voyager-builder .`)
  shell.mkdir(`-p`, `../../builds`)
  const cwd = process.cwd()

  shell.exec(`docker run \
      --interactive \
      --mount type=bind,readonly,source=${untildify(gaia)},target=/mnt/gaia \
      --mount type=bind,readonly,source=${path.resolve(cwd, '../../.git')},target=/mnt/.git \
      --mount type=bind,source=${path.resolve(cwd, '../../builds')},target=/mnt/builds \
      --rm \
      cosmos/voyager-builder \
        "${commit}" \
        --gaia=/mnt/gaia \
        --platform=${platform} \
        --skip-pack=${skipPack}
  `)
})
