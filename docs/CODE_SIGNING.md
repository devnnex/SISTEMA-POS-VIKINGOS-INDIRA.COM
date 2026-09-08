# Firma de Windows

Obtén de una autoridad certificadora un certificado **Code Signing** válido para el publisher real, exportable como `.pfx` e incluyendo su clave privada. El Subject debe corresponder a la identidad que verá el usuario; actualiza `bundle.publisher` si el nombre legal difiere.

Configura estos GitHub Secrets en el Environment `production`:

- `WINDOWS_CERTIFICATE`: contenido binario del `.pfx` codificado en Base64, sin saltos ni prefijos.
- `WINDOWS_CERTIFICATE_PASSWORD`: contraseña de exportación del `.pfx`.

PowerShell para generar el Base64:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Clipboard
```

El release usa SHA-256, timestamp RFC 3161 de DigiCert y verifica ejecutable e instalador con SignTool `/pa /all`. El certificado temporal se elimina del runner y nunca se publica como artefacto.
