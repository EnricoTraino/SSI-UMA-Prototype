import{
    createAgent,
    type IDIDManager,
    type IKeyManager,
    type IResolver,
    type ICredentialPlugin,
}from "@veramo/core";

import{
    DIDManager,
    MemoryDIDStore,
}from "@veramo/did-manager";

import{
    KeyManager,
    MemoryKeyStore,
    MemoryPrivateKeyStore
}from "@veramo/key-manager";

import{
    KeyManagementSystem
}from "@veramo/kms-local";

import{
    KeyDIDProvider,
    getDidKeyResolver
}from "@veramo/did-provider-key";

import{
    DIDResolverPlugin
}from "@veramo/did-resolver";

import{
    CredentialPlugin
}from "@veramo/credential-w3c";

import{
    CredentialProviderJWT
}from "@veramo/credential-jwt";

export const agent = createAgent<
    IDIDManager &
    IKeyManager &
    IResolver &
    ICredentialPlugin
    >({
        plugins:[
            new KeyManager({
                store: new MemoryKeyStore(),
                kms:{
                    local: new KeyManagementSystem(new MemoryPrivateKeyStore())
                }
            }),
            new DIDManager({
                store: new MemoryDIDStore(),
                defaultProvider: "did:key",
                providers: {
                    "did:key" : new KeyDIDProvider({
                        defaultKms: "local"
                    })
                }
            }),
            new DIDResolverPlugin({
                ...getDidKeyResolver()
            }),
            new CredentialPlugin([
                new CredentialProviderJWT()
            ])
        ]
    });