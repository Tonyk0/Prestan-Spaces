const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3000;

const DATA_FILE   = path.join(__dirname, 'data', 'houses.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// ── AFRICA'S TALKING SMS ──────────────────────────────────────
// To enable SMS: run  npm install africastalking
// Then replace YOUR_API_KEY_HERE with your real key from africastalking.com
let smsClient = null;
try {
  const AfricasTalking = require('africastalking');
  const AT = AfricasTalking({ apiKey: 'YOUR_API_KEY_HERE', username: 'sandbox' });
  smsClient = AT.SMS;
  console.log('✅ Africa\'s Talking SMS ready');
} catch(e) {
  console.log('⚠️  SMS not active — run: npm install africastalking');
}

async function sendSMS(phone, message) {
  if (!smsClient) return;
  let num = phone.replace(/\s/g, '');
  if (num.startsWith('07') || num.startsWith('01')) num = '+254' + num.slice(1);
  else if (num.startsWith('254')) num = '+' + num;
  try {
    const r = await smsClient.send({ to: [num], message: message, from: 'Prestan Spaces' });
    console.log('📱 SMS sent to ' + num + ': ' + r.SMSMessageData.Message);
  } catch(err) {
    console.log('⚠️  SMS failed: ' + err.message);
  }
}

// ── FILE UPLOAD ───────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e6) + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase())
      ? cb(null, true) : cb(new Error('Images only'));
  }
});

function read()  { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; } }
function write(d){ fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

// ── ROUTES ────────────────────────────────────────────────────

app.get('/api/houses', (req, res) => res.json({ success: true, houses: read() }));

app.get('/api/houses/:id', (req, res) => {
  const h = read().find(h => h.id === req.params.id);
  if (!h) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, house: h });
});

app.post('/api/houses', upload.array('photos', 10), (req, res) => {
  try {
    const { title, location, description, price, type, bedrooms, bathrooms, guests, contact, postedBy } = req.body;
    if (!title || !location || !description || !price)
      return res.status(400).json({ success: false, message: 'All fields required' });
    const houses = read();
    const photos = req.files && req.files.length > 0 ? req.files.map(f => '/uploads/' + f.filename) : [];
    const h = {
      id: Date.now().toString(),
      title: title.trim(), location: location.trim(),
      description: description.trim(), price: Number(price),
      type: type || 'rental', bedrooms: bedrooms || '',
      bathrooms: bathrooms || '', guests: guests || '',
      contact: contact || '', postedBy: postedBy || '',
      photos, likes: 0, booked: false, viewings: [],
      amenities: req.body.amenities ? req.body.amenities.split(',').filter(Boolean) : [],
      createdAt: new Date().toISOString()
    };
    houses.push(h);
    write(houses);
    const typeLabel = h.type === 'bnb' ? 'BnB' : h.type === 'sale' ? 'For Sale' : 'Rental';
    console.log('\n' + '-'.repeat(56));
    console.log('🏠  NEW LISTING: ' + h.title + ' (' + typeLabel + ')');
    console.log('    Location : ' + h.location + ' | Price: KSh ' + h.price.toLocaleString());
    console.log('    Posted by: ' + (h.postedBy || 'Anonymous'));
    console.log('-'.repeat(56) + '\n');
    res.status(201).json({ success: true, house: h });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.patch('/api/houses/:id/book', (req, res) => {
  try {
    const houses = read();
    const i = houses.findIndex(h => h.id === req.params.id);
    if (i === -1) return res.status(404).json({ success: false, message: 'Not found' });

    const prop   = houses[i];
    const isBnb  = req.body.isBnb;
    const cardName = req.body.cardName;
    const phone    = req.body.phone;
    const date     = req.body.date;
    const time     = req.body.time;

    if (isBnb) {
      prop.booked   = true;
      prop.bookedBy = cardName || phone || 'Anonymous';
      prop.bookedAt = new Date().toISOString();
    }

    // ── VALIDATE DATE IS IN THE FUTURE ──────────────────────────
    if (date) {
      const now      = new Date();
      const apptDate = new Date(date);

      if (time) {
        const clean  = time.replace(' AM','').replace(' PM','');
        const parts  = clean.split(':');
        const hh     = parseInt(parts[0]) || 0;
        const mm     = parseInt(parts[1]) || 0;
        const isPM   = time.includes('PM') && hh !== 12;
        const isAM12 = time.includes('AM') && hh === 12;
        const hour24 = isPM ? hh + 12 : isAM12 ? 0 : hh;
        apptDate.setHours(hour24, mm, 0, 0);
      } else {
        apptDate.setHours(23, 59, 0, 0);
      }

      // Only reject if the date is strictly in the past (before today)
      // Time is never used to block bookings
      const nowMidnight  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const apptMidnight = new Date(apptDate.getFullYear(), apptDate.getMonth(), apptDate.getDate());

      if (apptMidnight < nowMidnight) {
        return res.status(400).json({
          success: false,
          message: 'The selected date has already passed. Please choose today or a future date.'
        });
      }
    }

    if (!prop.viewings) prop.viewings = [];
    const appt = {
      id:               Date.now().toString(),
      clientName:       cardName || 'Anonymous',
      phone:            phone    || '',
      date:             date     || '',
      time:             time     || '',
      type:             isBnb ? 'bnb' : 'viewing',
      propertyId:       prop.id,
      propertyTitle:    prop.title,
      propertyLocation: prop.location,
      propertyType:     prop.type,
      propertyPrice:    prop.price,
      propertySection:  prop.type === 'bnb' ? 'Short Stays (BnB)' :
                        prop.type === 'sale' ? 'House Purchasing' : 'Monthly Rentals',
      bookedAt:         new Date().toISOString()
    };
    prop.viewings.push(appt);
    write(houses);

    // Terminal notification
    console.log('\n' + '='.repeat(64));
    console.log(isBnb ? '🛎  NEW BnB BOOKING' : '🔔  NEW VIEWING APPOINTMENT');
    console.log('='.repeat(64));
    console.log('  SECTION   : ' + appt.propertySection);
    console.log('  Property  : ' + prop.title + ' — ' + prop.location);
    console.log('  Client    : ' + appt.clientName + '  |  Phone: ' + appt.phone);
    console.log('  Date/Time : ' + appt.date + (appt.time ? ' at ' + appt.time : ''));
    console.log('  Received  : ' + new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }));
    console.log('='.repeat(64) + '\n');

    // SMS to client
    if (appt.phone) {
      var smsText;
      if (isBnb) {
        smsText = 'Dear ' + appt.clientName + ', your BnB booking at Prestan Spaces has been received! ' +
                  'Property: ' + prop.title + ', ' + prop.location + '. ' +
                  'Check-in: ' + appt.date + '. ' +
                  'Our agent will contact you shortly. Queries: 0746220862 - Prestan Spaces';
      } else {
        smsText = 'Dear ' + appt.clientName + ', your viewing appointment at Prestan Spaces has been received! ' +
                  'Property: ' + prop.title + ', ' + prop.location + '. ' +
                  'Date: ' + appt.date + ' at ' + appt.time + '. ' +
                  'Viewing fee: KSh 1,500 payable at property. ' +
                  'Queries: 0746220862 - Prestan Spaces';
      }
      sendSMS(appt.phone, smsText);
    }

    res.json({ success: true, house: prop, appointment: appt });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.patch('/api/houses/:id/mark-booked', (req, res) => {
  try {
    const houses = read();
    const i = houses.findIndex(h => h.id === req.params.id);
    if (i === -1) return res.status(404).json({ success: false, message: 'Not found' });
    houses[i].booked   = req.body.booked !== false;
    houses[i].bookedBy = req.body.bookedBy || 'Admin';
    houses[i].bookedAt = new Date().toISOString();
    write(houses);
    console.log('\n✅  Unit marked as ' + (houses[i].booked ? 'BOOKED' : 'AVAILABLE') + ': ' + houses[i].title + '\n');
    res.json({ success: true, house: houses[i] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/viewings', (req, res) => {
  try {
    const houses = read();
    const all = [];
    houses.forEach(function(h) {
      (h.viewings || []).forEach(function(v) {
        all.push(Object.assign({}, v, {
          propertyTitle:    v.propertyTitle    || h.title,
          propertyLocation: v.propertyLocation || h.location,
          propertyType:     v.propertyType     || h.type,
          propertySection:  v.propertySection  || (h.type === 'bnb' ? 'Short Stays (BnB)' : h.type === 'sale' ? 'House Purchasing' : 'Monthly Rentals'),
          propertyPrice:    v.propertyPrice    || h.price,
          propertyId:       v.propertyId       || h.id,
          unitBooked:       h.booked
        }));
      });
    });
    all.sort(function(a, b) { return new Date(b.bookedAt) - new Date(a.bookedAt); });
    res.json({ success: true, viewings: all });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.patch('/api/houses/:id/like', (req, res) => {
  try {
    const houses = read();
    const i = houses.findIndex(h => h.id === req.params.id);
    if (i === -1) return res.status(404).json({ success: false, message: 'Not found' });
    houses[i].likes = Math.max(0, (houses[i].likes || 0) + (req.body.increment === 1 ? 1 : -1));
    write(houses);
    res.json({ success: true, house: houses[i] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/houses/:id', (req, res) => {
  try {
    var houses = read();
    var h = houses.find(h => h.id === req.params.id);
    if (!h) return res.status(404).json({ success: false, message: 'Not found' });
    if (h.photos) h.photos.forEach(function(p) {
      var fp = path.join(__dirname, p);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    write(houses.filter(h => h.id !== req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── APPOINTMENT REMINDERS ─────────────────────────────────────
// Runs every 60 seconds — reminds you at 60min, 30min and 10min before each appointment
function checkReminders() {
  var houses = read();
  var now    = new Date();

  houses.forEach(function(h) {
    (h.viewings || []).forEach(function(v) {
      if (!v.date || !v.time) return;

      // Parse time e.g. "10:00 AM"
      var clean  = v.time.replace(' AM','').replace(' PM','');
      var parts  = clean.split(':');
      var hh     = parseInt(parts[0]) || 0;
      var mm     = parseInt(parts[1]) || 0;
      var isPM   = v.time.indexOf('PM') !== -1 && hh !== 12;
      var isAM12 = v.time.indexOf('AM') !== -1 && hh === 12;
      var hour24 = isPM ? hh + 12 : (isAM12 ? 0 : hh);

      var apptDate = new Date(v.date);
      apptDate.setHours(hour24, mm, 0, 0);

      var diffMin = Math.round((apptDate - now) / 60000);

      if (diffMin !== 60 && diffMin !== 30 && diffMin !== 10) return;

      // Check we haven't already reminded at this interval
      if (!v.remindedAt) v.remindedAt = [];
      if (v.remindedAt.indexOf(diffMin) !== -1) return;
      v.remindedAt.push(diffMin);

      var urgency = diffMin <= 10 ? '🚨🚨🚨' : diffMin <= 30 ? '⚠️ ' : '🔔 ';
      console.log('\n' + '#'.repeat(64));
      console.log(urgency + ' REMINDER — ' + diffMin + ' MINUTES TO APPOINTMENT');
      console.log('#'.repeat(64));
      console.log('  Property  : ' + (v.propertyTitle    || h.title));
      console.log('  Location  : ' + (v.propertyLocation || h.location));
      console.log('  Client    : ' + v.clientName + '  |  Phone: ' + v.phone);
      console.log('  Scheduled : ' + v.date + ' at ' + v.time);
      if (diffMin <= 10) console.log('  *** CLIENT IS ALMOST DUE — BE READY! ***');
      console.log('#'.repeat(64) + '\n');

      // SMS reminder to client
      if (v.phone) {
        var msg;
        if (diffMin <= 10) {
          msg = 'Hi ' + v.clientName + ', your property viewing at Prestan Spaces is in ' + diffMin + ' minutes! ' +
                'Property: ' + (v.propertyTitle || h.title) + ', ' + (v.propertyLocation || h.location) + '. ' +
                'See you soon! - Prestan Spaces 0746220862';
        } else {
          msg = 'Hi ' + v.clientName + ', reminder: your property viewing at Prestan Spaces is in ' + diffMin + ' minutes. ' +
                'Property: ' + (v.propertyTitle || h.title) + ' at ' + v.time + '. ' +
                'Queries: 0746220862 - Prestan Spaces';
        }
        sendSMS(v.phone, msg);
      }
    });
  });

  write(houses);
}

setInterval(checkReminders, 60 * 1000);

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use(function(err, req, res, next) {
  res.status(500).json({ success: false, message: err.message || 'Server error' });
});

app.listen(PORT, function() {
  console.log('\n' + '='.repeat(56));
  console.log('  Prestan Spaces — Server Started');
  console.log('='.repeat(56));
  console.log('  URL    : http://localhost:' + PORT);
  console.log('  Region : Nairobi & Kiambu County');
  console.log('  Phones : 0746220862 / 0702659854');
  console.log('='.repeat(56));
  console.log('  Reminder checker active — checks every 60 seconds');
  console.log('='.repeat(56) + '\n');
});


// ── FIX TYPES ENDPOINT ────────────────────────────────────────
app.get('/api/fix-types', (req, res) => {
  try {
    const houses = read();
    let fixed = 0;
    houses.forEach(h => {
      if (!h.type || h.type === '') {
        h.type = 'rental';
        fixed++;
      }
      if (h.description && h.description.includes('\\n')) {
        h.description = h.description.replace(/\\n/g, '\n');
        fixed++;
      }
    });
    write(houses);
    res.json({ success: true, message: 'Fixed ' + fixed + ' listings', total: houses.length, houses: houses });
  } catch(err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── FIX SALE TYPES ────────────────────────────────────────────
// Visit http://localhost:3000/api/fix-sale to repair "For Sale" listings
app.get('/api/fix-sale', (req, res) => {
  try {
    const houses = read();
    console.log('\n All houses in database:');
    houses.forEach((h, i) => {
      console.log(`  ${i+1}. "${h.title}" — type: "${h.type}" — location: "${h.location}"`);
    });
    res.json({
      success: true,
      total: houses.length,
      byType: {
        rental: houses.filter(h => h.type === 'rental').length,
        bnb:    houses.filter(h => h.type === 'bnb').length,
        sale:   houses.filter(h => h.type === 'sale').length,
        other:  houses.filter(h => !['rental','bnb','sale'].includes(h.type)).length,
      },
      houses: houses.map(h => ({ id: h.id, title: h.title, type: h.type, location: h.location }))
    });
  } catch(err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── MANUALLY SET TYPE FOR A HOUSE ─────────────────────────────
// PATCH /api/houses/:id/set-type  body: { type: "sale" }
app.patch('/api/houses/:id/set-type', (req, res) => {
  try {
    const houses = read();
    const i = houses.findIndex(h => h.id === req.params.id);
    if (i === -1) return res.status(404).json({ success: false, message: 'Not found' });
    const oldType = houses[i].type;
    houses[i].type = req.body.type;
    write(houses);
    console.log(`\n✅ Fixed: "${houses[i].title}" type changed from "${oldType}" → "${req.body.type}"\n`);
    res.json({ success: true, house: houses[i] });
  } catch(err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
