# ✈️ Voa Aí

> Saiba quando quem você espera chega.

**Voa Aí** acompanha voos em tempo real: decolagem, atrasos, mudanças de portão e pouso. Usa a [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/).

O nome é um trocadilho: *"tô indo aí"* virou *"voa aí"*.

## Status

🚧 Em definição. Escopo e stack ainda não foram decididos.

## Documentação

- [AeroAPI: referência completa (PDF)](docs/aeroapi/AeroAPI-FlightAware.pdf): endpoints, parâmetros, respostas e preços.
- [Spec OpenAPI oficial](docs/aeroapi/fonte/aeroapi-openapi.yml)
- [Como regenerar o PDF](docs/aeroapi/README.md)

## Configuração

A chave da AeroAPI nunca deve ir para o repositório. Use uma variável de ambiente:

```bash
export AEROAPI_KEY="sua-chave"
```
