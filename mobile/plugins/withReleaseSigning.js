// Signs release builds (APK and AAB) with the CMA Office upload key when the
// build machine provides it. The key itself never lives in this repository:
// GitHub Actions writes it to a temporary file from the repository secrets and
// passes these environment variables:
//   CMA_UPLOAD_STORE_FILE      path to the .keystore file
//   CMA_UPLOAD_STORE_PASSWORD  its password (also the key password)
//   CMA_UPLOAD_KEY_ALIAS       key alias (default "upload")
// Without them, release builds keep the template debug key (fine for
// side-loading, not accepted by Google Play).
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// cma-upload-signing";

const SIGNING = `
        release { ${MARK}
            if (System.getenv("CMA_UPLOAD_STORE_FILE")) {
                storeFile file(System.getenv("CMA_UPLOAD_STORE_FILE"))
                storePassword System.getenv("CMA_UPLOAD_STORE_PASSWORD")
                keyAlias(System.getenv("CMA_UPLOAD_KEY_ALIAS") ?: "upload")
                keyPassword System.getenv("CMA_UPLOAD_STORE_PASSWORD")
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;
    // 1) add a "release" signing config next to the template's "debug" one
    const before = g;
    g = g.replace(/(signingConfigs\s*\{)/, `$1${SIGNING}`);
    if (g === before) throw new Error("withReleaseSigning: signingConfigs block not found in app/build.gradle");
    // 2) make the release build type use it when the key is present
    const re = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
    if (!re.test(g)) throw new Error("withReleaseSigning: release signingConfig line not found in app/build.gradle");
    g = g.replace(re, `$1signingConfig(System.getenv("CMA_UPLOAD_STORE_FILE") ? signingConfigs.release : signingConfigs.debug)`);
    cfg.modResults.contents = g;
    return cfg;
  });
};
