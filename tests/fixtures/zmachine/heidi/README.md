# Heidi Z5 qualification fixture

This is the unmodified Inform 6 source for *Heidi* by Roger Firth and Sonja Kesserich, plus a compiled raw Z5 build. The authors’ redistribution notice is preserved in [LICENSE](LICENSE). The upstream source and walkthrough are pinned to [revision 8d550526](https://github.com/i6/ibg/tree/8d550526b269f558672e254a25ca0b4856ee0507).

From the parent fixture directory, with the [Inform 6.44 compiler and 6.12.8 library](../README.md):

```powershell
& ./tools/inform6-6.44/inform6.exe -v5 '+include_path=lib' '$SERIAL=040804' heidi/Heidi.inf heidi/Heidi.z5
(Get-FileHash -LiteralPath heidi/Heidi.z5 -Algorithm SHA256).Hash
```

The story is 95,744 bytes including zero padding. Its SHA-256 is `3b271bd00c0062a5fe9829094f2b85357fbe26d179a3e852eb4f749aed2fc6e7`. Use the authenticated picker to exercise file ingestion. The runtime uses the bytes supplied through the picker.
