// Verification-only config: dependencies are shared through a directory junction.
import {mergeConfig,defineConfig} from 'vitest/config'
import base from './vite.config'
import {realpathSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('.',import.meta.url))
export default mergeConfig(base,defineConfig({server:{fs:{allow:[root,realpathSync(new URL('./node_modules',import.meta.url))]}}}))
