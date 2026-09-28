/**
 * @fileoverview src/lib/i18n/index.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';
import ab from './locales/ab';
import ady from './locales/ady';
import af from './locales/af';
import ak from './locales/ak';
import alt from './locales/alt';
import am from './locales/am';
import an from './locales/an';
import ani from './locales/ani';
import aqc from './locales/aqc';
import ar from './locales/ar';
import arp from './locales/arp';
import ast from './locales/ast';
import av from './locales/av';
import ay from './locales/ay';
import az from './locales/az';
import ba from './locales/ba';
import bdk from './locales/bdk';
import be from './locales/be';
import bg from './locales/bg';
import bm from './locales/bm';
import bn from './locales/bn';
import br from './locales/br';
import bs from './locales/bs';
import ca from './locales/ca';
import ce from './locales/ce';
import ceb from './locales/ceb';
import chr from './locales/chr';
import cjs from './locales/cjs';
import clw from './locales/clw';
import co from './locales/co';
import crh from './locales/crh';
import cs from './locales/cs';
import cv from './locales/cv';
import cy from './locales/cy';
import da from './locales/da';
import dar from './locales/dar';
import ddo from './locales/ddo';
import de from './locales/de';
import dlg from './locales/dlg';
import doi from './locales/doi';
import dv from './locales/dv';
import ee from './locales/ee';
import egl from './locales/egl';
import el from './locales/el';
import en from './locales/en';
import eo from './locales/eo';
import es from './locales/es';
import et from './locales/et';
import eu from './locales/eu';
import ext from './locales/ext';
import fa from './locales/fa';
import fax from './locales/fax';
import fi from './locales/fi';
import fo from './locales/fo';
import fr from './locales/fr';
import fur from './locales/fur';
import fy from './locales/fy';
import ga from './locales/ga';
import gag from './locales/gag';
import gd from './locales/gd';
import gl from './locales/gl';
import gn from './locales/gn';
import gu from './locales/gu';
import ha from './locales/ha';
import haw from './locales/haw';
import hi from './locales/hi';
import hmn from './locales/hmn';
import hr from './locales/hr';
import ht from './locales/ht';
import hu from './locales/hu';
import hy from './locales/hy';
import id from './locales/id';
import ig from './locales/ig';
import ilo from './locales/ilo';
import inh from './locales/inh';
import is from './locales/is';
import it from './locales/it';
import iw from './locales/iw';
import ja from './locales/ja';
import jv from './locales/jv';
import jw from './locales/jw';
import ka from './locales/ka';
import kaa from './locales/kaa';
import kab from './locales/kab';
import kbd from './locales/kbd';
import kim from './locales/kim';
import kjh from './locales/kjh';
import kjj from './locales/kjj';
import kk from './locales/kk';
import klj from './locales/klj';
import km from './locales/km';
import kn from './locales/kn';
import ko from './locales/ko';
import kok from './locales/kok';
import krc from './locales/krc';
import kri from './locales/kri';
import kry from './locales/kry';
import ku from './locales/ku';
import kum from './locales/kum';
import ky from './locales/ky';
import la from './locales/la';
import lb from './locales/lb';
import lbe from './locales/lbe';
import lez from './locales/lez';
import lg from './locales/lg';
import li from './locales/li';
import lij from './locales/lij';
import lld from './locales/lld';
import lmo from './locales/lmo';
import ln from './locales/ln';
import lo from './locales/lo';
import lt from './locales/lt';
import lv from './locales/lv';
import mai from './locales/mai';
import mg from './locales/mg';
import mi from './locales/mi';
import mk from './locales/mk';
import ml from './locales/ml';
import mn from './locales/mn';
import mni from './locales/mni';
import mr from './locales/mr';
import ms from './locales/ms';
import mt from './locales/mt';
import mwl from './locales/mwl';
import my from './locales/my';
import mzo from './locales/mzo';
import nap from './locales/nap';
import ne from './locales/ne';
import nl from './locales/nl';
import no from './locales/no';
import nog from './locales/nog';
import nso from './locales/nso';
import ny from './locales/ny';
import oc from './locales/oc';
import om from './locales/om';
import or from './locales/or';
import pa from './locales/pa';
import pcd from './locales/pcd';
import pl from './locales/pl';
import pms from './locales/pms';
import ps from './locales/ps';
import pt from './locales/pt';
import qu from './locales/qu';
import rm from './locales/rm';
import ro from './locales/ro';
import roaleo from './locales/roa-leo';
import roatara from './locales/roa-tara';
import ru from './locales/ru';
import rut from './locales/rut';
import rw from './locales/rw';
import sa from './locales/sa';
import sah from './locales/sah';
import sat from './locales/sat';
import sc from './locales/sc';
import scn from './locales/scn';
import sd from './locales/sd';
import si from './locales/si';
import sk from './locales/sk';
import sl from './locales/sl';
import slr from './locales/slr';
import sm from './locales/sm';
import sn from './locales/sn';
import so from './locales/so';
import sq from './locales/sq';
import sr from './locales/sr';
import st from './locales/st';
import su from './locales/su';
import sv from './locales/sv';
import sw from './locales/sw';
import szl from './locales/szl';
import ta from './locales/ta';
import tab from './locales/tab';
import te from './locales/te';
import tg from './locales/tg';
import th from './locales/th';
import ti from './locales/ti';
import tk from './locales/tk';
import tkr from './locales/tkr';
import tl from './locales/tl';
import tr from './locales/tr';
import ts from './locales/ts';
import tt from './locales/tt';
import tyv from './locales/tyv';
import udi from './locales/udi';
import ug from './locales/ug';
import uk from './locales/uk';
import ur from './locales/ur';
import uz from './locales/uz';
import ve from './locales/ve';
import vec from './locales/vec';
import vi from './locales/vi';
import vls from './locales/vls';
import wa from './locales/wa';
import wo from './locales/wo';
import xh from './locales/xh';
import yi from './locales/yi';
import yo from './locales/yo';
import zhTW from './locales/zh-TW';
import zh from './locales/zh';
import zu from './locales/zu';

const i18n = new I18n({
  ab: ab,
  ady: ady,
  af: af,
  ak: ak,
  alt: alt,
  am: am,
  an: an,
  ani: ani,
  aqc: aqc,
  ar: ar,
  arp: arp,
  ast: ast,
  av: av,
  ay: ay,
  az: az,
  ba: ba,
  bdk: bdk,
  be: be,
  bg: bg,
  bm: bm,
  bn: bn,
  br: br,
  bs: bs,
  ca: ca,
  ce: ce,
  ceb: ceb,
  chr: chr,
  cjs: cjs,
  clw: clw,
  co: co,
  crh: crh,
  cs: cs,
  cv: cv,
  cy: cy,
  da: da,
  dar: dar,
  ddo: ddo,
  de: de,
  dlg: dlg,
  doi: doi,
  dv: dv,
  ee: ee,
  egl: egl,
  el: el,
  en: en,
  eo: eo,
  es: es,
  et: et,
  eu: eu,
  ext: ext,
  fa: fa,
  fax: fax,
  fi: fi,
  fo: fo,
  fr: fr,
  fur: fur,
  fy: fy,
  ga: ga,
  gag: gag,
  gd: gd,
  gl: gl,
  gn: gn,
  gu: gu,
  ha: ha,
  haw: haw,
  hi: hi,
  hmn: hmn,
  hr: hr,
  ht: ht,
  hu: hu,
  hy: hy,
  id: id,
  ig: ig,
  ilo: ilo,
  inh: inh,
  is: is,
  it: it,
  iw: iw,
  ja: ja,
  jv: jv,
  jw: jw,
  ka: ka,
  kaa: kaa,
  kab: kab,
  kbd: kbd,
  kim: kim,
  kjh: kjh,
  kjj: kjj,
  kk: kk,
  klj: klj,
  km: km,
  kn: kn,
  ko: ko,
  kok: kok,
  krc: krc,
  kri: kri,
  kry: kry,
  ku: ku,
  kum: kum,
  ky: ky,
  la: la,
  lb: lb,
  lbe: lbe,
  lez: lez,
  lg: lg,
  li: li,
  lij: lij,
  lld: lld,
  lmo: lmo,
  ln: ln,
  lo: lo,
  lt: lt,
  lv: lv,
  mai: mai,
  mg: mg,
  mi: mi,
  mk: mk,
  ml: ml,
  mn: mn,
  mni: mni,
  mr: mr,
  ms: ms,
  mt: mt,
  mwl: mwl,
  my: my,
  mzo: mzo,
  nap: nap,
  ne: ne,
  nl: nl,
  no: no,
  nog: nog,
  nso: nso,
  ny: ny,
  oc: oc,
  om: om,
  or: or,
  pa: pa,
  pcd: pcd,
  pl: pl,
  pms: pms,
  ps: ps,
  pt: pt,
  qu: qu,
  rm: rm,
  ro: ro,
  'roa-leo': roaleo,
  'roa-tara': roatara,
  ru: ru,
  rut: rut,
  rw: rw,
  sa: sa,
  sah: sah,
  sat: sat,
  sc: sc,
  scn: scn,
  sd: sd,
  si: si,
  sk: sk,
  sl: sl,
  slr: slr,
  sm: sm,
  sn: sn,
  so: so,
  sq: sq,
  sr: sr,
  st: st,
  su: su,
  sv: sv,
  sw: sw,
  szl: szl,
  ta: ta,
  tab: tab,
  te: te,
  tg: tg,
  th: th,
  ti: ti,
  tk: tk,
  tkr: tkr,
  tl: tl,
  tr: tr,
  ts: ts,
  tt: tt,
  tyv: tyv,
  udi: udi,
  ug: ug,
  uk: uk,
  ur: ur,
  uz: uz,
  ve: ve,
  vec: vec,
  vi: vi,
  vls: vls,
  wa: wa,
  wo: wo,
  xh: xh,
  yi: yi,
  yo: yo,
  'zh-TW': zhTW,
  zh: zh,
  zu: zu,
});

i18n.enableFallback = true;
i18n.defaultLocale = 'en';

export const setI18nConfig = (languageCode: string) => {
  if (languageCode === 'system') {
    const locales = getLocales();
    i18n.locale = locales && locales.length > 0 ? locales[0].languageCode ?? 'en' : 'en';
  } else {
    i18n.locale = languageCode;
  }
};

export default i18n;
