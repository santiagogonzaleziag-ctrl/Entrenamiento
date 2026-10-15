"""Login único en Garmin Connect (soporta MFA).

Ejecútalo UNA vez en tu ordenador:

    pip install --upgrade garminconnect curl_cffi
    python scripts/login.py

Guarda los tokens en ~/.garminconnect/garmin_tokens.json e imprime una
cadena base64 que debes pegar como secreto GARMIN_TOKENS en GitHub.
Tu contraseña nunca se guarda en ningún sitio.
"""

import base64
import os
from getpass import getpass
from pathlib import Path

from garminconnect import Garmin

TOKENSTORE = Path("~/.garminconnect").expanduser()


def main() -> None:
    email = os.getenv("GARMIN_EMAIL") or input("Email de Garmin: ").strip()
    password = getpass("Contraseña de Garmin: ")

    client = Garmin(email, password, prompt_mfa=lambda: input("Código MFA: ").strip())
    client.login(str(TOKENSTORE))

    name = client.get_full_name()
    print(f"\n✓ Sesión iniciada como {name}")

    token_file = TOKENSTORE / "garmin_tokens.json"
    if not token_file.exists():
        raise SystemExit(f"No encuentro {token_file}; revisa la versión de garminconnect (>=0.3).")

    b64 = base64.b64encode(token_file.read_bytes()).decode()
    print("\nCopia esta cadena completa en GitHub → Settings → Secrets and variables →")
    print("Actions → New repository secret, con el nombre GARMIN_TOKENS:\n")
    print(b64)
    print("\n⚠ Trátala como una contraseña: da acceso de lectura/escritura a tu cuenta.")


if __name__ == "__main__":
    main()
