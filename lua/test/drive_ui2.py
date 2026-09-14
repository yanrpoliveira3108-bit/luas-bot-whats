import os, pty, select, subprocess, time, signal, re, json

CWD = '/home/user/lua'
ANSI = re.compile(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b[\(\)][0-9;?]*')

def clean(s):
    s = s.replace('\r', '')
    return ANSI.sub('', s)

class UISession:
    def __init__(self):
        self.master, slave = pty.openpty()
        self.p = subprocess.Popen(['node', 'index.js'], stdin=slave, stdout=slave, stderr=slave,
                                  cwd=CWD, env={**os.environ, 'LUA_NO_UI': ''}, start_new_session=True)
        os.close(slave)
        self.raw = b''
        self.text = ''
        self.pos = 0
    def read_until(self, marker, timeout=25):
        deadline = time.time() + timeout
        while True:
            r, _, _ = select.select([self.master], [], [], 0.3)
            if r:
                try:
                    data = os.read(self.master, 4096)
                except OSError:
                    return False
                if not data:
                    return False
                self.raw += data
                self.text = clean(self.raw.decode('utf-8', 'ignore'))
            idx = self.text.find(marker, self.pos)
            if idx != -1:
                self.pos = idx + len(marker)
                return True
            if time.time() > deadline:
                return False
    def send(self, s):
        os.write(self.master, s.encode())
    def stop(self):
        try:
            os.killpg(self.p.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
        time.sleep(2)
        try:
            self.p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.p.kill()

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('✅' if ok else '❌') + ' ' + name + (' — ' + detail if detail else ''))
    if not ok:
        raise SystemExit(1)

print('=== CENÁRIO A: número ambíguo (sem +, sem país padrão) ===')
a = UISession()
try:
    check('menu principal', a.read_until('CONEXÃO DO LUA', 25))
    a.send('1\n')
    check('tela de número', a.read_until('NÚMERO DO WHATSAPP', 10))
    a.send('1\n')
    check('prompt Número:', a.read_until('Número:', 10))
    # 819012345678 não é válido como BR (padrão) → detecção global → ambíguo
    a.send('819012345678\n')
    check('detecta ambiguidade', a.read_until('Não foi possível determinar o país', 10))
    check('lista candidatos (Japão)', a.read_until('Japão', 5))
    a.send('1\n')  # primeiro candidato (JP)
    check('confirma com o país escolhido', a.read_until('CONFIRMAR NÚMERO', 10))
    check('mostra Japão', a.read_until('Japão', 5))
    a.send('0\n')  # cancelar
    check('volta ao prompt de número', a.read_until('Número:', 10))
    a.send('0\n')  # cancelar
    check('volta ao menu principal', a.read_until('CONEXÃO DO LUA', 10))
    a.send('0\n')  # sair
finally:
    a.stop()

print('\n=== CENÁRIO B: sessão existente → restauração automática ===')
# cria uma sessão fake apenas para validar o fluxo "sessão encontrada → restaurar"
os.makedirs(CWD + '/session', exist_ok=True)
fake_creds = {
    "noiseKey": {"public": b"".join([b'\x01']*32).decode('latin1'), "private": b"".join([b'\x02']*32).decode('latin1')},
    "signedIdentityKey": {"public": b"".join([b'\x03']*32).decode('latin1'), "private": b"".join([b'\x04']*32).decode('latin1')},
    "signedPreKey": {"keyId": 1, "keyPair": {"public": b"".join([b'\x05']*32).decode('latin1'), "private": b"".join([b'\x06']*32).decode('latin1')}, "signature": b"".join([b'\x07']*64).decode('latin1')},
    "registrationId": 1,
    "advSecretKey": "adv",
    "nextPreKeyId": 1,
    "firstUnuploadedPreKeyId": 1,
    "accountSyncCounter": 0,
    "accountSettings": {"unarchiveChats": False},
    "registered": True,
    "me": {"id": "5519999999999:12@s.whatsapp.net", "name": "Lua"},
}
with open(CWD + '/session/creds.json', 'w') as f:
    json.dump(fake_creds, f)

b = UISession()
try:
    check('splash', b.read_until('LUA BOT', 25))
    check('sessão encontrada', b.read_until('Sessão encontrada', 15))
    check('restaurando sessão', b.read_until('Restaurando sessão', 15))
finally:
    b.stop()

print('\n=== RESULTADO: %d verificações, todas OK ===' % len(results))
