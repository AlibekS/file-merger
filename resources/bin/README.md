# Встроенные движки (необязательно)

Если положить сюда бинарники Ghostscript и qpdf, они попадут в установщик
и пользователю не придётся ничего устанавливать отдельно.

```
resources/bin/win/gs/bin/gswin64c.exe      (+ gsdll64.dll и lib/ из дистрибутива Ghostscript)
resources/bin/win/qpdf/bin/qpdf.exe        (+ DLL из zip-архива qpdf для Windows)
resources/bin/mac/gs                        (или gs/bin/gs)
resources/bin/mac/qpdf                      (или qpdf/bin/qpdf)
resources/bin/linux/gs, resources/bin/linux/qpdf
```

Порядок поиска движков: переменные окружения `PDFSTUDIO_GS` / `PDFSTUDIO_QPDF` →
эта папка → стандартные пути установки (`C:\Program Files\gs\…`, Homebrew) → `PATH`.

Лицензии: Ghostscript распространяется под AGPL-3.0 (или коммерческой лицензией
Artifex), qpdf — Apache-2.0. Учитывайте это при распространении сборки со встроенным Ghostscript.
