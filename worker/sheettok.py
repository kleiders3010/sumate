# The code a device sends on one sheet, made from its secret (localStorage sumate.token) the way web/app.js tokenFor
# does it: HMAC-SHA256(secret, "sumate-sheet|" + sheet id), its first 20 bytes as letters (safety round 3, S5).
import hashlib
import hmac

ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"


def sheet_token(secret, sheet_id):
    sig = hmac.new(secret.encode(), ("sumate-sheet|" + sheet_id).encode(), hashlib.sha256).digest()[:20]
    return "".join(ALPHABET[b % 32] for b in sig)
