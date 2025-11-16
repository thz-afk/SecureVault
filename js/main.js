'use strict';

/**
 * Main Entry Point
 * Inicializa a aplicação
 */
const app = new App();

// Verificação periódica de expiração de autenticação
setInterval(() => {
    if (app.store && !app.store.isAuthenticated() && app.store.vault) {
        // Se autenticação expirou, redireciona para tela de login
        app.store.lock();
        location.reload();
    }
}, 5000); // Verifica a cada 5 segundos

window.addEventListener('load', () => {
    setTimeout(() => {
        const genBtn = document.getElementById('genPwdBtn');
        if (genBtn) genBtn.click();
    }, 100);
});

