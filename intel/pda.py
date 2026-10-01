"""Associated token account address, no dependencies (base58 + ed25519 off-curve check)."""
import hashlib
A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58d(s):
    n = 0
    for c in s: n = n * 58 + A.index(c)
    b = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    return b'\0' * (len(s) - len(s.lstrip('1'))) + b
def b58e(b):
    n = int.from_bytes(b, 'big'); s = ''
    while n: n, r = divmod(n, 58); s = A[r] + s
    return '1' * (len(b) - len(b.lstrip(b'\0'))) + s
P = 2 ** 255 - 19; D = -121665 * pow(121666, P - 2, P) % P
def on_curve(b):
    y = int.from_bytes(b, 'little') & ((1 << 255) - 1)
    if y >= P: return False
    u = (y * y - 1) % P; v = (D * y * y + 1) % P
    x2 = u * pow(v, P - 2, P) % P
    if x2 == 0: return True
    return pow(x2, (P - 1) // 2, P) == 1
def pda(seeds, prog):
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b''.join(seeds) + bytes([bump]) + prog + b'ProgramDerivedAddress').digest()
        if not on_curve(h): return b58e(h)
TOKEN = b58d('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'); T22 = b58d('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
ATA = b58d('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
def atas(owner, mint):
    return [pda([b58d(owner), t, b58d(mint)], ATA) for t in (TOKEN, T22)]
