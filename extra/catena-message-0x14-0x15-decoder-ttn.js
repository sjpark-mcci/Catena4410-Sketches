// This function decodes the record (port 1, format 0x15) sent by the
// MCCI Catena 4450 soil/water application.
// For use with console.thethingsnetwork.org
// 2017-09-19 add dewpoints.

// calculate dewpoint (degrees C) given temperature (C) and relative humidity (0..100)
// from http://andrew.rsmas.miami.edu/bmcnoldy/Humidity.html
// rearranged for efficiency and to deal sanely with very low (< 1%) RH
function dewpoint(t, rh) {
    var c1 = 243.04;
    var c2 = 17.625;
    var h = rh / 100;
    if (h <= 0.01)
        h = 0.01;
    else if (h > 1.0)
        h = 1.0;

    var lnh = Math.log(h);
    var tpc1 = t + c1;
    var txc2 = t * c2;
    var txc2_tpc1 = txc2 / tpc1;

    var tdew = c1 * (lnh + txc2_tpc1) / (c2 - lnh - txc2_tpc1);
    return tdew;
}

function Decoder(bytes, port) {
    // Decode an uplink message from a buffer
    // (array) of bytes to an object of fields.
    var decoded = {};

    if (port === 1) {
        cmd = bytes[0];
        if (cmd == 0x14) {
            // decode Catena 4450 M101 data

            // test vectors:
            //  14 01 18 00 ==> vBat = 1.5
            //  14 01 F8 00 ==> vBat = -0.5
            //  14 05 F8 00 42 ==> boot: 66, vBat: -0.5
            //  14 0D F8 00 42 17 80 59 35 80 ==> adds one temp of 23.5, rh = 50, p = 913.48

            // i is used as the index into the message. Start with the flag byte.
            var i = 1;
            // fetch the bitmap.
            var flags = bytes[i++];

            if (flags & 0x1) {
                // set vRaw to a uint16, and increment pointer
                var vRaw = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                // interpret uint16 as an int16 instead.
                if (vRaw & 0x8000)
                    vRaw += -0x10000;
                // scale and save in decoded.
                decoded.vBat = vRaw / 4096.0;
            }

            if (flags & 0x2) {
                var vRawBus = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                if (vRawBus & 0x8000)
                    vRawBus += -0x10000;
                decoded.vBus = vRawBus / 4096.0;
            }

            if (flags & 0x4) {
                var iBoot = bytes[i];
                i += 1;
                decoded.boot = iBoot;
            }

            if (flags & 0x8) {
                // we have temp, pressure, RH
                var tRaw = (bytes[i] << 8) + bytes[i + 1];
                if (tRaw & 0x8000)
                    tRaw = -0x10000 + tRaw;
                i += 2;
                var pRaw = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                var hRaw = bytes[i++];

                decoded.tempC = tRaw / 256;
                decoded.error = "none";
                decoded.p = pRaw * 4 / 100.0;
                decoded.rh = hRaw / 256 * 100;
                decoded.tDewC = dewpoint(decoded.tempC, decoded.rh);
            }

            if (flags & 0x10) {
                // we have lux
                var luxRaw = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                decoded.lux = luxRaw;
            }

            if (flags & 0x20) {
                // watthour
                var powerIn = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                var powerOut = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                decoded.powerUsedCount = powerIn;
                decoded.powerSourcedCount = powerOut;
            }

            if (flags & 0x40) {
                // normalize floating pulses per hour
                var floatIn = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                var floatOut = (bytes[i] << 8) + bytes[i + 1];
                i += 2;

                var exp1 = floatIn >> 12;
                var exp2 = floatOut >> 12;
                var mant1 = (floatIn & 0xFFF) / 4096.0;
                var mant2 = (floatOut & 0xFFF) / 4096.0;
                var powerPerHourIn = mant1 * Math.pow(2, exp1 - 15) * 60 * 60 * 4;
                var powerPerHourOut = mant2 * Math.pow(2, exp2 - 15) * 60 * 60 * 4;
                decoded.powerUsedPerHour = powerPerHourIn;
                decoded.powerSourcedPerHour = powerPerHourOut;
            }
        } else if (cmd == 0x15) {
            // decode Catena 4450 M102 data

            // test vectors:
            //  15 01 18 00 ==> vBat = 1.5
            //  15 01 F8 00 ==> vBat = -0.5
            //  15 05 F8 00 42 ==> boot: 66, vBat: -0.5
            //  15 0D F8 00 42 17 80 59 35 80 ==> adds one temp of 23.5, rh = 50, p = 913.48, tDewC = 12.5
            //  15 7D 44 60 0D 15 9D 5F CD C3 00 00 1C 11 14 46 E4 ==>
            //	{
            //    "boot": 13,
            //    "error": "none",
            //    "lux": 0,
            //    "p": 981,
            //    "rh": 76.171875,
            //    "rhSoil": 89.0625,
            //    "tDewC": 17.236466758309017,
            //    "tSoil": 20.2734375,
            //    "tSoilDew": 18.411840342527178,
            //    "tWater": 28.06640625,
            //    "tempC": 21.61328125,
            //    "vBat": 4.2734375,
            //    }
            // 15 7D 43 72 07 17 A4 5F CB A7 01 DB 1C 01 16 AF C3
            //    {
            //    "boot": 7,
            //    "error": "none",
            //    "lux": 475,
            //    "p": 980.92,
            //    "rh": 65.234375,
            //    "rhSoil": 76.171875,
            //    "tDewC": 16.732001483771757,
            //    "tSoil": 22.68359375,
            //    "tSoilDew": 18.271601276518467,
            //    "tWater": 28.00390625,
            //    "tempC": 23.640625,
            //    "vBat": 4.21533203125
            //    }	  
            // i is used as the index into the message. Start with the flag byte.
            var i = 1;
            // fetch the bitmap.
            var flags = bytes[i++];

            if (flags & 0x1) {
                // set vRaw to a uint16, and increment pointer
                var vRaw = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                // interpret uint16 as an int16 instead.
                if (vRaw & 0x8000)
                    vRaw += -0x10000;
                // scale and save in decoded.
                decoded.vBat = vRaw / 4096.0;
            }

            if (flags & 0x2) {
                var vRawBus = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                if (vRawBus & 0x8000)
                    vRawBus += -0x10000;
                decoded.vBus = vRawBus / 4096.0;
            }

            if (flags & 0x4) {
                var iBoot = bytes[i];
                i += 1;
                decoded.boot = iBoot;
            }

            if (flags & 0x8) {
                // we have temp, pressure, RH
                var tRaw = (bytes[i] << 8) + bytes[i + 1];
                if (tRaw & 0x8000)
                    tRaw = -0x10000 + tRaw;
                i += 2;
                var pRaw = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                var hRaw = bytes[i++];

                decoded.tempC = tRaw / 256;
                decoded.error = "none";
                decoded.p = pRaw * 4 / 100.0;
                decoded.rh = hRaw / 256 * 100;
                decoded.tDewC = dewpoint(decoded.tempC, decoded.rh);
            }

            if (flags & 0x10) {
                // we have lux
                var luxRaw = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                decoded.lux = luxRaw;
            }

            if (flags & 0x20) {
                // onewire temperature
                var tempRaw = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                decoded.tWater = tempRaw / 256;
            }

            if (flags & 0x40) {
                // temperature followed by RH
                var tempRaw = (bytes[i] << 8) + bytes[i + 1];
                i += 2;
                var tempRH = bytes[i];
                i += 1;
                decoded.tSoil = tempRaw / 256;
                decoded.rhSoil = tempRH / 256 * 100;
                decoded.tSoilDew = dewpoint(decoded.tSoil, decoded.rhSoil);
            }
        } else {
            // nothing
        }
    }
    return decoded;
}