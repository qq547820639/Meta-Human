# Sign & Notarize

Generated: 2026-08-05T03:46:13Z

```text
-- Sign & Notarize closure --
UNVERIFIED  Developer ID Application identity
            valid identities found: 0
            requires: a Developer ID Application certificate in the login keychain
            obtain:  https://developer.apple.com/account/resources/certificates/list
            then:    security import <cert>.p12 -k ~/Library/Keychains/login.keychain-db
            or set  CODE_SIGN_IDENTITY=<certDisplayName>
UNVERIFIED  codesign (no identity) on /Volumes/Extra/CodeProj/数字人/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app
FAIL        app signature does not verify (Signature=adhoc TeamIdentifier=not set)
FAIL        spctl --assess --type execute rejected app (Gatekeeper would block)
UNVERIFIED  notarization credentials
            requires: APPLE_TEAM_ID, APPLE_NOTARY_API_KEY, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER
            create:   https://appstoreconnect.apple.com/access/api
UNVERIFIED  notarization + stapling (credentials absent)
Release closure FAILED with 2 FAIL and 4 UNVERIFIED item(s).
```
