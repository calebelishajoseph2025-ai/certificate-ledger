from pathlib import Path
p = Path('.monkeycode/uploads/Certificate_Ledger___Tamper-Evident_Credential_Issuance___Verification.pdf')
data = p.read_bytes()
print('size', p.stat().st_size)
print('type page spaced', data.count(b'/Type /Page'))
print('type page tight', data.count(b'/Type/Page'))
idx = 0
n = 0
while True:
    i = data.find(b'MediaBox', idx)
    if i < 0:
        break
    n += 1
    print(data[i:i+48])
    idx = i + 8
print('mediabox count', n)
