Este directorio contiene el archivo data.json que persiste usuarios y tokens de refresco.
Estructura:
{
"users": { "email": {userObject} },
"usersById": { "userId": "email" },
"refresh": { "tokenId": { userId, exp, revoked } }
}

No subir datos sensibles a repositorios públicos. Añadir este archivo a .gitignore si el repo se hace público.
