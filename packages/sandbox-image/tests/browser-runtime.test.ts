import { describe, it, expect } from "vitest"
import {
  BROWSER_APT_PACKAGES,
  BROWSER_LAYER_PIN,
  browserInstallCommand,
  PYTHON_PACKAGES,
  pythonInstallCommand,
  CHROMIUM_BIN,
  CHROMEDRIVER_BIN,
} from "../src/image"

/**
 * Browser automation in the sandbox.
 *
 * Selenium needs a chromedriver whose major version matches the browser it
 * drives; a mismatch fails at session start with "This version of ChromeDriver
 * only supports Chrome version N". Debian builds chromium-driver from the same
 * source as chromium, so installing both in one apt transaction is what makes
 * the match structural rather than something to keep checking.
 */

describe("browser runtime", () => {
  it("installs the browser and its driver together", () => {
    // One transaction, not two layers: separate installs can resolve to
    // different versions if the index moves between them, and that mismatch is
    // the classic Selenium failure.
    expect(BROWSER_APT_PACKAGES).toContain("chromium")
    expect(BROWSER_APT_PACKAGES).toContain("chromium-driver")

    const cmd = browserInstallCommand()
    const installs = cmd.match(/apt-get install/g) ?? []
    expect(installs).toHaveLength(1)
    for (const pkg of BROWSER_APT_PACKAGES) expect(cmd).toContain(pkg)
  })

  it("carries a pin token so the layer can be forced to rebuild", () => {
    // apt has no usable exact-version pin here — old versions leave the
    // mirror and the build breaks. This token is the deliberate equivalent:
    // the command string changes when someone bumps it, which is the only
    // thing that actually invalidates a cached layer.
    expect(BROWSER_LAYER_PIN).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(browserInstallCommand()).toContain(BROWSER_LAYER_PIN)
  })

  it("pins every python package to an exact version", () => {
    const names = Object.keys(PYTHON_PACKAGES)
    expect(names.length).toBeGreaterThan(0)
    for (const [name, version] of Object.entries(PYTHON_PACKAGES)) {
      expect(version, name).toMatch(/^\d+\.\d+(\.\d+)?$/)
      expect(pythonInstallCommand()).toContain(`${name}==${version}`)
    }
  })

  it("ships what the pricing bot imports at module level", () => {
    // crm_pricing_bot.py imports selenium and webdriver_manager at import
    // time, so a missing one is an ImportError before any flag can help.
    // pandas/openpyxl are what reads the supplier spreadsheets.
    for (const pkg of ["selenium", "webdriver-manager", "pandas", "openpyxl"]) {
      expect(PYTHON_PACKAGES, pkg).toHaveProperty(pkg)
    }
  })

  it("installs python packages despite Debian's managed-environment guard", () => {
    // bookworm ships PEP 668, so a plain `pip install` into the system
    // interpreter is refused outright. Without this flag the layer fails.
    expect(pythonInstallCommand()).toContain("--break-system-packages")
  })

  it("names the binaries the driver and browser actually land on", () => {
    // Debian installs chromium at these paths; the script otherwise falls back
    // to downloading a driver at runtime, which needs network mid-run.
    expect(CHROMIUM_BIN).toBe("/usr/bin/chromium")
    expect(CHROMEDRIVER_BIN).toBe("/usr/bin/chromedriver")
  })
})
