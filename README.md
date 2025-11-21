
# SecureVault

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Security](https://img.shields.io/badge/security-AES256-green.svg)
![Dependencies](https://img.shields.io/badge/dependencies-kdbxweb-lightgrey.svg)
![Status](https://img.shields.io/badge/status-stable-orange.svg)

> **Client-side Password Manager.**
> Sem servidor. Sem tracking. Sem frescura.

O **SecureVault** é uma interface web estática para gerenciamento de credenciais. Ele roda 100% no navegador do usuário, utilizando a `localStorage` ou arquivos físicos para persistência. O foco: ter controle total dos dados sem depender de nuvens de terceiros.

---

##  Como funciona

Ao contrário de gerenciadores comerciais (LastPass, 1Password), o SecureVault não possui backend.
O arquivo `index.html` contém toda a lógica necessária para cifrar e decifrar seus dados localmente.

| Recurso | Status | Detalhes |
| :--- | :---: | :--- |
| **Backend** | ❌ | Zero. Nada sai do seu browser. |
| **Criptografia** | ✅ | AES-256 via biblioteca `kdbxweb`. |
| **Persistência** | ✅ | LocalStorage + Exportação de Arquivos. |
| **Offline** | ✅ | Funciona sem internet (PWA ready). |
| **Recuperação** | ❌ | Se perder a senha mestre, já era. |

##  Instalação

Não requer `npm install`, `build` ou containers Docker complexos. É HTML puro.

### Rodando Localmente

```bash
# 1. Clone o repo
git@github.com:thz-afk/SecureVault.git

# 2. Entre na pasta
cd securevault

# 3. Abra no navegador
# (No Linux/Mac)
open index.html
# (No Windows)
start index.html
```

### Hospedagem (Opcional)

Como é estático, você pode jogar no GitHub Pages, Vercel, Netlify ou até num bucket S3.
O servidor apenas entrega o HTML/JS; a criptografia ocorre na máquina do cliente.

---

## Segurança e Arquitetura

O projeto segue uma política estrita de **Zero Knowledge**.

```javascript
// Exemplo simplificado da lógica de segurança
const vault = {
    serverAccess: false,
    analytics: false,
    encryption: 'AES-256',
    keyStorage: 'Memory Only (RAM)'
};
```

### Content Security Policy (CSP)
O `index.html` possui uma CSP rigorosa para evitarXSS e conexões externas não autorizadas:

`default-src 'none'; script-src 'self'; style-src 'self';`

### Formatos de Exportação

| Extensão | Tipo | Segurança | Recomendado? |
| :--- | :--- | :--- | :---: |
| `.kdbx` | KeePass Database | 🔒 Alta (Cifrado) | ⭐ Sim |
| `.json` | JSON Raw | 🔓 Nenhuma (Texto Plano) | ⚠️ Não |
| `.csv` | Planilha | 🔓 Nenhuma (Texto Plano) | ⚠️ Não |

---


---

## ☑️ Roadmap / Todo

- [x] Interface Flat Dark (Anti-bloat)
- [x] Implementação AES-256
- [x] Gen de Senhas (com entropia configurável)
- [ ] Suporte a 2FA (OTP)
- [ ] Sincronização WebDAV (Opcional)
- [ ] Tradução EN/ES

---

## Aviso Legal

**Use por sua conta e risco.**
Embora utilizemos bibliotecas de criptografia padrão da indústria (`kdbxweb`), a segurança final depende do ambiente onde o código é executado.

1. Não use em computadores públicos/infectados
3. **Nós não podemos recuperar sua senha mestre**

---

[Reportar Bug](https://github.com/thz-afk/securevault/issues) • [Licença MIT](LICENSE)
