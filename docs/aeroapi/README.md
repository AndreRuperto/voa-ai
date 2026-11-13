# FlightAware AeroAPI: documentação

- **[AeroAPI-FlightAware.pdf](AeroAPI-FlightAware.pdf)**: referência completa da AeroAPI v4.17.1 (58 endpoints, ~110 páginas). Inclui guia rápido, planos e preços, parâmetros, respostas e modelos de dados.
- `fonte/aeroapi-openapi.yml`: especificação OpenAPI oficial, baixada de https://flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml
- `fonte/precos.json`: preço por endpoint, extraído de https://www.flightaware.com/commercial/aeroapi/
- `gerador/`: scripts que geram o PDF.

## Regenerar o PDF

Requer Python 3 com `pyyaml` e `markdown`, mais Node com `playwright`.

```bash
cd docs/aeroapi
curl -sSL https://flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml -o fonte/aeroapi-openapi.yml
python3 gerador/gen.py fonte/aeroapi-openapi.yml fonte/precos.json /tmp/aeroapi.html gerador/doc.css
node gerador/pdf.js /tmp/aeroapi.html "$PWD/AeroAPI-FlightAware.pdf"
```
