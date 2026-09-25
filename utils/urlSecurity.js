/**
 * utils/urlSecurity.js — Validação rigorosa de URLs, hostnames e proteção contra SSRF.
 *
 * Em conformidade com as diretrizes OWASP para prevenção de Server-Side Request Forgery:
 * - Apenas esquemas permitidos (http:, https:)
 * - Verificação de hostnames legítimos por domínio exato ou subdomínio estrito (sem startsWith/includes ingênuo)
 * - Bloqueio de localhost, loopback, endereços privados (RFC 1918), link-local, redes reservadas (IPv4 e IPv6)
 * - Resolução segura de DNS para detecção de rebind / IPs internos
 */

'use strict';

const dns = require('dns').promises;
const net = require('net');

/** Domínios permitidos para serviços de música/vídeo */
const ALLOWED_MUSIC_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'spotify.com',
  'open.spotify.com',
  'deezer.com',
  'soundcloud.com',
];

/**
 * Verifica se um endereço IP é privado, local, reservado ou multicast.
 */
function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  const kind = net.isIP(ip);
  if (kind === 0) return true; // não é IP válido

  if (kind === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return true;
    const [b0, b1, b2, b3] = parts;

    // 0.0.0.0/8 (Endereço "este host")
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (Privado RFC 1918)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (Privado RFC 1918)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Privado RFC 1918)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-local / APIPA / Metadados AWS 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (CGNAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (TEST-NET)
    if (b0 === 192 && b1 === 0 && b2 === 2) return true;
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;
    // 240.0.0.0/4 (Reservado para uso futuro) & 255.255.255.255 (Broadcast)
    if (b0 >= 240) return true;

    return false;
  }

  if (kind === 6) {
    const normalized = ip.toLowerCase();
    // ::1 (Loopback) & :: (Unspecified)
    if (normalized === '::1' || normalized === '::') return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (normalized.startsWith('::ffff:')) {
      const ipv4Part = normalized.slice(7);
      return isPrivateIp(ipv4Part);
    }
    // fe80::/10 (Link-local)
    if (normalized.startsWith('fe80:') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    // fc00::/7 & fd00::/8 (Unique Local Address)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // ff00::/8 (Multicast)
    if (normalized.startsWith('ff')) return true;

    return false;
  }

  return true;
}

/**
 * Valida se um hostname pertence aos domínios autorizados.
 */
function isAllowedDomain(hostname, allowedList = ALLOWED_MUSIC_DOMAINS) {
  if (!hostname || typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().trim().replace(/\.$/, '');
  return allowedList.some((domain) => host === domain || host.endsWith('.' + domain));
}

/**
 * Validação segura de URL síncrona.
 */
function validateSafeUrl(rawUrl, allowedDomains = ALLOWED_MUSIC_DOMAINS) {
  if (!rawUrl || typeof rawUrl !== 'string') return { valid: false, reason: 'URL vazia ou inválida' };

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return { valid: false, reason: 'Formato de URL inválido' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Protocolo não suportado' };
  }

  // Prevenção contra injeção de credenciais na URL (ex: https://user:pass@domain)
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Credenciais na URL não permitidas' };
  }

  const hostname = parsed.hostname;

  // Se for endereço IP direto, bloqueia imediatamente qualquer IP privado/local
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { valid: false, reason: 'Acesso a endereço IP local ou privado bloqueado (SSRF)' };
    }
  }

  // Se uma lista de domínios permitidos for exigida
  if (allowedDomains && allowedDomains.length > 0) {
    if (!isAllowedDomain(hostname, allowedDomains)) {
      return { valid: false, reason: `Domínio não permitido: ${hostname}` };
    }
  }

  return { valid: true, parsed, url: parsed.toString() };
}

/**
 * Validação assíncrona profunda com resolução de DNS para prevenir DNS Rebinding / SSRF.
 */
async function assertSafeDestination(rawUrl, allowedDomains = ALLOWED_MUSIC_DOMAINS) {
  const syncCheck = validateSafeUrl(rawUrl, allowedDomains);
  if (!syncCheck.valid) {
    const err = new Error(syncCheck.reason);
    err.code = 'SSRF_BLOCKED';
    throw err;
  }

  const hostname = syncCheck.parsed.hostname;

  // Se já for IP, a checagem síncrona já garantiu que não é privado
  if (net.isIP(hostname)) return syncCheck.url;

  // Resolve DNS para validar o IP de destino
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        const err = new Error(`Hostname ${hostname} resolveu para endereço IP privado (${record.address})`);
        err.code = 'SSRF_BLOCKED';
        throw err;
      }
    }
  } catch (dnsErr) {
    if (dnsErr.code === 'SSRF_BLOCKED') throw dnsErr;
    const err = new Error(`Falha ao resolver DNS para ${hostname}`);
    err.code = 'DNS_FAILED';
    throw err;
  }

  return syncCheck.url;
}

module.exports = {
  isPrivateIp,
  isAllowedDomain,
  validateSafeUrl,
  assertSafeDestination,
  ALLOWED_MUSIC_DOMAINS,
};
