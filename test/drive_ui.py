import os, pty, select, subprocess, sys, time, signal, re

# spawn node index.js dentro de um PTY (simula terminal interativo real)
master, slave = pty.openpty()
p = subprocess.Popen(
    ['node', 'index.js'],
    stdin=slave, stdout=slave, stderr=slave,
    cwd='/home/user/lua',
    env={**os.environ, 'LUA_NO_UI': ''},
    start_new_session=True,
)
os.close(slave)

rawbuf = b''
cleantext = ''
pos = 0

def clean(s):
    s = s.replace('\r', '')
    s = re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]', '', s)
    s = re.sub(r'\x1b[c\(\)][0-9;?]*', '', s)
    return s

def read_until(marker, timeout=25):
    global rawbuf, cleantext, pos
    deadline = time.time() + timeout
    while True:
        r, _, _ = select.select([master], [], [], 0.3)
        if r:
            try:
                data = os.read(master, 4096)
            except OSError:
                return False
            if not data:
                return False
            rawbuf += data
            cleantext = clean(rawbuf.decode('utf-8', 'ignore'))
        idx = cleantext.find(marker, pos)
        if idx != -1:
            pos = idx + len(marker)  # consome só até o marcador
            return True
        if time.time() > deadline:
            return False

def send(s):
    os.write(master, s.encode())

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('✅' if ok else '❌') + ' ' + name + (' — ' + detail if detail else ''))
    if not ok:
        print('---- DEBUG OUTPUT (últimos 4000 chars) ----')
        print(cleantext[-4000:])
        print('-------------------------------------------')
        raise SystemExit(1)

# 1. splash
check('splash com "LUA BOT"', read_until('LUA BOT', 30))
check('"Inicializando sistema..."', read_until('Inicializando sistema', 10))
check('boot: "Banco de dados conectado"', read_until('Banco de dados conectado', 20))
check('boot: "Comandos carregados"', read_until('Comandos carregados', 20))
check('boot: "Sistema de conexão iniciado"', read_until('Sistema de conexão iniciado', 20))

# 2. menu principal (sem sessão)
check('menu "CONEXÃO DO LUA"', read_until('CONEXÃO DO LUA', 15))
check('opções [1] Conectar WhatsApp', read_until('[1] Conectar WhatsApp', 5))

# 3. verificar sistema
send('3\n')
check('menu "VERIFICAR SISTEMA"', read_until('VERIFICAR SISTEMA', 10))
check('mostra Node/Comandos', read_until('Comandos:', 5))
send('\n')  # volta
check('volta ao menu principal', read_until('CONEXÃO DO LUA', 10))

# 4. configurações
send('2\n')
check('menu "CONFIGURAÇÕES"', read_until('CONFIGURAÇÕES', 10))
check('mostra país padrão', read_until('País padrão', 5))
send('0\n')  # volta
check('volta ao menu principal (2)', read_until('CONEXÃO DO LUA', 10))

# 5. conectar → número
send('1\n')
check('tela "NÚMERO DO WHATSAPP"', read_until('NÚMERO DO WHATSAPP', 10))
check('modo guiado [2] Escolher país', read_until('[2] Escolher país manualmente', 5))

# 5b. modo automático
send('1\n')
check('prompt "Número:"', read_until('Número:', 10))

# 6. número válido +55
send('+55 19 99999-9999\n')
check('confirmação "CONFIRMAR NÚMERO"', read_until('CONFIRMAR NÚMERO', 10))
check('identifica Brasil', read_until('Brasil', 5))
check('mascara o número (+55 ****)', read_until('****', 5))

# 7. confirmar → prepara conexão (não esperamos o WhatsApp real)
send('1\n')
check('"Número validado"', read_until('Número validado', 10))
check('"Preparando conexão"', read_until('Preparando conexão', 10))

# 8. encerrar com SIGINT (shutdown limpo)
print('→ enviando SIGINT para encerrar...')
os.killpg(p.pid, signal.SIGINT)
time.sleep(2)
try:
    p.wait(timeout=5)
except subprocess.TimeoutExpired:
    p.kill()

print('\n=== RESULTADO: %d verificações de UI, todas OK ===' % len(results))
