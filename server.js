const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ตัวแปรสำรองกรณีตาราง settings ยังไม่ได้สร้าง
let memorySettings = {
  bank_info: 'กสิกรไทย 123-4-56789-0 (บจก. อีคอมโมบิ วินเทจ)',
  admin_pin: '1688'
};

// ดึงข้อมูลทั้งหมดแบบเรียลไทม์จากฐานข้อมูลกลาง
app.get('/api/dashboard', async (req, res) => {
  const { data: members } = await supabase.from('members').select('*').order('created_at', { ascending: false });
  const { data: products } = await supabase.from('products').select('*').order('created_at', { ascending: false });
  const { data: transactions } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
  const { data: financeRequests } = await supabase.from('finance_requests').select('*').order('created_at', { ascending: false });
  const { data: orders } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  const { data: settingsData, error: settingsErr } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();

  if (settingsData && !settingsErr) {
    memorySettings = {
      bank_info: settingsData.bank_info || memorySettings.bank_info,
      admin_pin: String(settingsData.admin_pin || memorySettings.admin_pin)
    };
  }

  res.json({
    members: members || [],
    products: products || [],
    transactions: transactions || [],
    financeRequests: financeRequests || [],
    orders: orders || [],
    settings: memorySettings
  });
});

// ตรวจสอบรหัสผ่านแอดมินจากฝั่งเซิร์ฟเวอร์โดยตรง (ปลอดภัยและใช้รหัสเดียวกันทุกเครื่อง)
app.post('/api/admin-login', async (req, res) => {
  const { pin } = req.body;
  const { data: settingsData } = await supabase.from('settings').select('admin_pin').eq('id', 1).maybeSingle();
  const currentPin = settingsData?.admin_pin ? String(settingsData.admin_pin) : String(memorySettings.admin_pin);

  if (String(pin).trim() === currentPin.trim()) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'รหัสผ่านแอดมินไม่ถูกต้อง' });
});

// บันทึกการตั้งค่ารหัสผ่านแอดมินและเลขบัญชี
app.post('/api/settings', async (req, res) => {
  const bankInfo = (req.body.bankInfo || '').trim() || memorySettings.bank_info;
  const adminPin = String(req.body.adminPin || '').trim() || memorySettings.admin_pin;

  // อัปเดตค่าในหน่วยความจำทันที
  memorySettings = { bank_info: bankInfo, admin_pin: adminPin };

  // บันทึกลงตาราง settings บน Supabase
  const { data, error } = await supabase
    .from('settings')
    .upsert({ id: 1, bank_info: bankInfo, admin_pin: adminPin }, { onConflict: 'id' })
    .select();

  if (error) {
    console.error('Supabase settings error:', error.message);
    return res.json({
      success: true,
      settings: memorySettings,
      warning: 'บันทึกในเซิร์ฟเวอร์แล้ว (อย่าลืมรัน SQL สร้างตาราง settings บน Supabase เพื่อเก็บถาวร)'
    });
  }

  res.json({ success: true, settings: data?.[0] || memorySettings });
});

// สมัครสมาชิกใหม่ / สมัครตัวแทน
app.post('/api/register', async (req, res) => {
  const { phone, name, password, bank, role } = req.body;
  const status = role === 'affiliate' ? 'pending' : 'member';
  const displayPhone = name ? `${phone} (${name})` : phone;

  const { data, error } = await supabase
    .from('members')
    .insert([{ phone: displayPhone, password: password || '1234', bank: bank || '', role: role || 'member', status, balance: 0, comm_balance: 0 }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, user: data[0] });
});

// ขอสมัครตัวแทน Affiliate สำหรับสมาชิกเดิม
app.post('/api/apply-affiliate', async (req, res) => {
  const { phone } = req.body;
  const { data, error } = await supabase
    .from('members')
    .update({ role: 'affiliate', status: 'pending' })
    .eq('phone', phone)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, user: data?.[0] });
});

// เพิ่มสินค้าเสื้อผ้ามือสอง
app.post('/api/products', async (req, res) => {
  const { name, size_detail, condition_grade, price, commission, image_url } = req.body;
  const { data, error } = await supabase
    .from('products')
    .insert([{ name, size_detail, condition_grade, price, commission, image_url, is_sold: false }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

// โหลดสินค้าตัวอย่าง 4 ชิ้นตามภาพต้นฉบับ
app.post('/api/seed-vintage-products', async (req, res) => {
  const sampleProducts = [
    {
      name: 'เสื้อยืดวินเทจ 90s กราฟิกร็อก USA ตะเข็บเดี่ยว บน-ล่าง',
      size_detail: 'เสื้อยืดวินเทจ 90s||L (อก 44" ยาว 29")||เฟดสีดำถ่านสวยตามธรรมชาติ ไม่มีรูขาด||มีตัวเดียว||12',
      condition_grade: 'สภาพ 95% วินเทจแท้',
      price: 1890,
      commission: 227,
      image_url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=700',
      is_sold: false
    },
    {
      name: 'สเวตเตอร์ฮู้ดดี้ Streetwear Oversize คัดหัวผ้าญี่ปุ่น',
      size_detail: 'สเวตเตอร์ & ฮู้ดดี้||XL (อก 48" ยาว 30")||ไม่มีตำหนิ ผ้านุ่มฟู ซักอบฆ่าเชื้อแล้ว||เหลือ 2 ชิ้น||10',
      condition_grade: 'สภาพ 98% นางฟ้า',
      price: 790,
      commission: 79,
      image_url: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=700',
      is_sold: false
    },
    {
      name: 'กางเกงยีนส์วินเทจ Levi\'s 501 กระดุม 555 ทรงกระบอกตรง',
      size_detail: 'กางเกงยีนส์ & คาร์โก้||W32 L40 (เอวจริง 32" ยาวทั้งตัว 40")||รอยเฟดหน้าขาและตะเข็บขึ้นสวย ปลายขาเดิม||มีตัวเดียว||10',
      condition_grade: 'สภาพ 92% เฟดสวย',
      price: 1450,
      commission: 145,
      image_url: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=700',
      is_sold: false
    },
    {
      name: 'แจ็คเก็ตยีนส์มือสอง Trucker Jacket ป้ายหนังวินเทจ',
      size_detail: 'แจ็คเก็ตมือสอง||L (อก 46" ยาว 26")||ไม่มีตำหนิ กระดุมครบทุกเม็ด||มีตัวเดียว||12',
      condition_grade: 'สภาพ 96% คัดเกรด A+',
      price: 1290,
      commission: 155,
      image_url: 'https://images.unsplash.com/photo-1551537482-f2075a1d41f2?w=700',
      is_sold: false
    }
  ];
  await supabase.from('products').insert(sampleProducts);
  res.json({ success: true });
});

// ลบสินค้า
app.delete('/api/products/:id', async (req, res) => {
  await supabase.from('products').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ส่งคำขอฝากเงิน / ถอนค่าคอมมิชชัน
app.post('/api/finance-request', async (req, res) => {
  const { reqType, phone, amount, slip, bank, source } = req.body;
  const { data: member } = await supabase.from('members').select('*').eq('phone', phone).maybeSingle();

  if (reqType === 'withdraw' && member) {
    if (source === 'commission' && Number(member.comm_balance) < Number(amount)) {
      return res.status(400).json({ error: 'ยอดค่าคอมมิชชันสะสมไม่เพียงพอ' });
    }
    if (source === 'wallet' && Number(member.balance) < Number(amount)) {
      return res.status(400).json({ error: 'เครดิตคงเหลือไม่เพียงพอ' });
    }
    if (source === 'commission') {
      await supabase.from('members').update({ comm_balance: Number(member.comm_balance) - Number(amount) }).eq('phone', phone);
    } else {
      await supabase.from('members').update({ balance: Number(member.balance) - Number(amount) }).eq('phone', phone);
    }
  }

  const { data, error } = await supabase
    .from('finance_requests')
    .insert([{ req_type: reqType, phone, amount, slip: slip || '', bank: bank || '', source: source || 'wallet', status: 'รอตรวจสอบ' }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

// แอดมินอนุมัติฝาก/ถอนเงิน
app.post('/api/approve-finance', async (req, res) => {
  const { requestId } = req.body;
  const { data: reqData } = await supabase.from('finance_requests').select('*').eq('id', requestId).single();
  if (!reqData || reqData.status === 'สำเร็จ') return res.status(400).json({ error: 'Invalid request' });

  const { data: member } = await supabase.from('members').select('*').eq('phone', reqData.phone).maybeSingle();

  if (reqData.req_type === 'deposit' && member) {
    await supabase.from('members').update({ balance: Number(member.balance) + Number(reqData.amount) }).eq('phone', reqData.phone);
    await supabase.from('transactions').insert([{ type: 'ฝากเงินเข้ากระเป๋า', phone: reqData.phone, amount: reqData.amount, sign: '+', status: 'สำเร็จ' }]);
  } else {
    await supabase.from('transactions').insert([{ type: 'ถอนค่าคอม/เครดิต', phone: reqData.phone, amount: reqData.amount, sign: '-', status: 'สำเร็จ' }]);
  }

  await supabase.from('finance_requests').update({ status: 'สำเร็จ' }).eq('id', requestId);
  res.json({ success: true });
});

// แอดมินเพิ่ม/หักเงินโดยตรง
app.post('/api/admin-adjust-balance', async (req, res) => {
  const { phone, amount, isDeduct } = req.body;
  let { data: member } = await supabase.from('members').select('*').eq('phone', phone).maybeSingle();

  if (!member) {
    const { data: newMem } = await supabase.from('members').insert([{ phone, password: '1234', role: 'member', status: 'member', balance: 0, comm_balance: 0 }]).select();
    member = newMem[0];
  }

  const newBalance = isDeduct ? Math.max(0, Number(member.balance) - Number(amount)) : Number(member.balance) + Number(amount);
  await supabase.from('members').update({ balance: newBalance }).eq('phone', phone);
  await supabase.from('transactions').insert([{
    type: isDeduct ? 'หักเงินโดยแอดมิน' : 'เพิ่มเงินโดยแอดมิน',
    phone,
    amount,
    sign: isDeduct ? '-' : '+',
    status: 'สำเร็จ'
  }]);

  res.json({ success: true });
});

// สร้างคำสั่งซื้อสินค้า
app.post('/api/orders', async (req, res) => {
  const { phone, address, affPhone, items, total, totalComm, slip, method } = req.body;

  if (method === 'wallet') {
    const { data: member } = await supabase.from('members').select('*').eq('phone', phone).maybeSingle();
    if (!member || Number(member.balance) < Number(total)) {
      return res.status(400).json({ error: 'เครดิตคงเหลือไม่เพียงพอ กรุณากดปุ่ม + เพื่อเติมเครดิตก่อนครับ' });
    }
    await supabase.from('members').update({ balance: Number(member.balance) - Number(total) }).eq('phone', phone);
  }

  const orderInsert = {
    phone,
    address,
    aff_phone: affPhone || '',
    total,
    total_comm: totalComm,
    slip: slip || '',
    status: method === 'wallet' ? 'รอแอดมินตรวจจัดส่ง (ตัดเครดิตแล้ว)' : 'รอตรวจสอบสลิป'
  };

  const { data: orderData, error } = await supabase.from('orders').insert([orderInsert]).select();
  if (error) return res.status(400).json({ error: error.message });

  const orderId = orderData[0].id;
  const orderItems = items.map(i => ({ order_id: orderId, product_id: i.id, product_name: i.name, price: i.price }));
  await supabase.from('order_items').insert(orderItems);

  if (method === 'wallet') {
    for (let i of items) {
      await supabase.from('products').update({ is_sold: true }).eq('id', i.id);
    }
    if (affPhone) {
      const { data: affMember } = await supabase.from('members').select('*').eq('phone', affPhone).maybeSingle();
      if (affMember) {
        await supabase.from('members').update({ comm_balance: Number(affMember.comm_balance) + Number(totalComm) }).eq('phone', affPhone);
      }
    }
    await supabase.from('transactions').insert([{ type: 'ซื้อเสื้อผ้าด้วยเครดิต', phone, amount: total, sign: '-', status: 'สำเร็จ' }]);
  }

  res.json({ success: true });
});

// แอดมินอนุมัติออเดอร์
app.post('/api/approve-order', async (req, res) => {
  const { orderId } = req.body;
  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order || order.status === 'อนุมัติจัดส่งแล้ว') return res.status(400).json({ error: 'Invalid order' });

  await supabase.from('orders').update({ status: 'อนุมัติจัดส่งแล้ว' }).eq('id', orderId);
  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
  if (items) {
    for (let i of items) {
      await supabase.from('products').update({ is_sold: true }).eq('id', i.product_id);
    }
  }

  if (order.aff_phone && !order.status.includes('ตัดเครดิตแล้ว')) {
    const { data: affMember } = await supabase.from('members').select('*').eq('phone', order.aff_phone).maybeSingle();
    if (affMember) {
      await supabase.from('members').update({ comm_balance: Number(affMember.comm_balance) + Number(order.total_comm) }).eq('phone', order.aff_phone);
    }
  }

  if (!order.status.includes('ตัดเครดิตแล้ว')) {
    await supabase.from('transactions').insert([{ type: 'รับชำระค่าสินค้า', phone: order.phone, amount: order.total, sign: '+', status: 'สำเร็จ' }]);
  }
  res.json({ success: true });
});

// แอดมินอนุมัติตัวแทน Affiliate
app.post('/api/approve-affiliate', async (req, res) => {
  await supabase.from('members').update({ status: 'approved', role: 'affiliate' }).eq('id', req.body.memberId);
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
