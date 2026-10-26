/* Units & Time plugin — conversions and timezone-aware current time. */
register({
  name: 'convert',
  description: 'Convert units: km/mi, m/ft, kg/lb, c/f, l/gal.',
  parameters: { type: 'object', properties: { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['value', 'from', 'to'] },
  run: function (args) {
    var v = Number(args.value), f = String(args.from).toLowerCase(), t = String(args.to).toLowerCase();
    var map = {
      'km-mi': [0.621371], 'mi-km': [1.609344], 'm-ft': [3.28084], 'ft-m': [0.3048],
      'kg-lb': [2.20462], 'lb-kg': [0.453592], 'l-gal': [0.264172], 'gal-l': [3.78541]
    };
    if ((f === 'c' && t === 'f')) return v + '°C = ' + (v * 9 / 5 + 32) + '°F';
    if ((f === 'f' && t === 'c')) return v + '°F = ' + ((v - 32) * 5 / 9).toFixed(2) + '°C';
    var k = f + '-' + t;
    if (map[k]) return v + ' ' + f + ' = ' + (v * map[k][0]).toFixed(4) + ' ' + t;
    return 'Error: unsupported pair ' + k + ' (try km/mi, m/ft, kg/lb, c/f, l/gal)';
  }
});
register({
  name: 'now',
  description: 'Current date/time, optionally in a IANA timezone (e.g. Asia/Kolkata).',
  parameters: { type: 'object', properties: { timezone: { type: 'string' } } },
  run: function (args) {
    try {
      var tz = args.timezone ? String(args.timezone) : undefined;
      return new Date().toLocaleString('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }) + (tz ? ' (' + tz + ')' : '');
    } catch (e) { return 'Error: unknown timezone'; }
  }
});
