// event_code da AeroAPI → texto do push em PT-BR (tabela de notificações da docs/02-v1-alertas.md).
// Os horários saem no fuso do aeroporto de destino.

/** Códigos que viram aviso, já agrupados (departure = off, arrival = on). */
export const EVENTO_NORMALIZADO = {
  out: 'out', off: 'off', departure: 'off', minutes_out: 'minutes_out',
  on: 'on', arrival: 'on', in: 'in', cancelled: 'cancelled', diverted: 'diverted',
};

/** Hora HH:MM no fuso indicado. */
export function hora(iso, fuso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const op = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    return new Intl.DateTimeFormat('pt-BR', { ...op, timeZone: fuso || 'UTC' }).format(new Date(t));
  } catch {
    return new Intl.DateTimeFormat('pt-BR', { ...op, timeZone: 'UTC' }).format(new Date(t));
  }
}

const nomeLugar = (l) => l?.cidade || l?.nome || l?.iata || l?.icao || 'o destino';

/**
 * Monta a notificação de um evento.
 * @param {string} evento event_code da AeroAPI ou "atraso"
 * @param {object} voo objeto Voo do contrato
 * @param {{apelido?: string|null, agora?: Date, desvio?: object|null}} [op]
 *   `desvio`: aeroporto novo (formato do contrato) quando o voo foi desviado
 * @returns {{titulo: string, corpo: string}|null} null para eventos que não viram aviso
 */
export function montarMensagem(evento, voo, { apelido = null, agora = new Date(), desvio = null } = {}) {
  const codigo = evento === 'atraso' ? 'atraso' : EVENTO_NORMALIZADO[evento];
  if (!codigo) return null;
  const nome = (apelido || '').trim();
  const doVoo = nome ? `O voo da ${nome}` : `O voo ${voo.ident || voo.ident_iata}`;
  const fuso = voo.destino?.fuso;
  const h = voo.horarios || {};
  const origem = nomeLugar(voo.origem);
  const destino = nomeLugar(voo.destino);
  let corpo;

  switch (codigo) {
    case 'out':
      corpo = `🚪 ${doVoo} saiu do portão em ${origem}`;
      break;
    case 'off': {
      const chegada = hora(h.chegada_estimada || h.pouso_estimado || h.chegada_prevista || h.pouso_previsto, fuso);
      corpo = `🛫 ${doVoo} decolou de ${origem}` + (chegada ? `. Chegada prevista às ${chegada}` : '');
      break;
    }
    case 'minutes_out': {
      const pouso = Date.parse(h.pouso_estimado || h.chegada_estimada || '');
      const min = Number.isFinite(pouso) ? Math.max(1, Math.round((pouso - agora.getTime()) / 60_000)) : 40;
      corpo = `⏳ ${doVoo} pousa em cerca de ${min} min em ${destino}. Hora de sair!`;
      break;
    }
    case 'on': {
      const pousou = hora(h.pouso_real || h.chegada_real || agora.toISOString(), fuso);
      corpo = `🛬 ${doVoo} pousou em ${destino} às ${pousou}`;
      break;
    }
    case 'in':
      corpo = nome ? `✅ A ${nome} chegou ao portão. Desembarque em breve` : `✅ ${doVoo} chegou ao portão. Desembarque em breve`;
      break;
    case 'cancelled':
      corpo = `❌ ${doVoo} foi cancelado pela companhia`;
      break;
    case 'diverted': {
      const para = desvio ? nomeLugar(desvio) : null;
      corpo = `⚠️ ${doVoo} foi desviado` + (para ? ` para ${para}` : '');
      break;
    }
    case 'atraso': {
      const nova = hora(h.chegada_estimada || h.pouso_estimado, fuso);
      corpo = `🕒 ${doVoo} está atrasado ${voo.atraso_min} min` + (nova ? `. Nova chegada: ${nova}` : '');
      break;
    }
  }
  return { titulo: 'Voa Aí', corpo };
}
