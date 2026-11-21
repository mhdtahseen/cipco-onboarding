// The vendor page's words in English, Hindi and Gujarati (most transport operators read one of these more easily than English).
// Amounts stay in Western digits with ₹, the way they appear on bills. A missing key falls back to English; the compiler checks hi and gu have every key.
export const VENDOR_LANGS = [
  { code: "en", native: "English", locale: "en-IN" },
  { code: "hi", native: "हिन्दी", locale: "hi-IN" },
  { code: "gu", native: "ગુજરાતી", locale: "gu-IN" },
] as const;
export type VLang = (typeof VENDOR_LANGS)[number]["code"];
export const isVLang = (c: unknown): c is VLang => VENDOR_LANGS.some((l) => l.code === c);

const en = {
  "set.t": "Choose your own PIN", "set.d": "The office gave you a temporary PIN. Now choose your own 4 to 6 digit PIN. Only you will know it.",
  "set.tExpired": "Time for a new PIN", "set.dExpired": "Your PIN is 30 days old. Choose a new 4 to 6 digit PIN, different from the old one.", "set.new": "New PIN", "set.again": "New PIN again", "set.cur": "Current PIN", "set.save": "Save my PIN", "set.saving": "Saving…", "set.saved": "Your PIN is saved. Use it next time. It lasts 30 days, then you choose a new one.",
  "set.mismatch": "The two PINs are not the same.", "set.weak": "That PIN is too easy to guess. Avoid 1111 or 1234.", "set.same": "Choose a PIN different from the one you have now.",
  "set.curWrong": "Your current PIN is not right.", "set.change": "Change my PIN", "set.changeT": "Change your PIN",
  "set.changeD": "Enter your current PIN, then your new one. Your other phones will need the new PIN.", "set.forgot": "Forgot your PIN? Ask the CIPCO office for a temporary one.",
  "f.from": "From", "f.to": "To", "f.fromPh": "e.g. Yard", "f.toPh": "e.g. Mundra port",
  "e.from": "Say where the trip started.", "e.to": "Say where the trip ended.",
  "lang": "Language", "hdr.account": "Vehicle account", "refresh": "Refresh", "refreshing": "Refreshing", "signOut": "Sign out", "loading": "Loading your account…",
  "gone.t": "This link is not active any more", "gone.d": "Ask the CIPCO office to send you a new link.",
  "pin.t": "Enter your PIN", "pin.d": "Enter your PIN. The first time, use the temporary PIN the CIPCO office gave you.", "pin.label": "PIN", "pin.hint": "4 to 6 digits.", "pin.show": "Show", "pin.hide": "Hide",
  "pin.open": "Open my account", "pin.checking": "Checking…", "pin.forgot": "Forgot your PIN? Ask the CIPCO office for a temporary one.",
  "pin.again": "For your safety, please enter your PIN again.", "pin.againErrand": "For your safety, please enter your PIN again. Your trip was not sent.",
  "pin.bad": "Enter the 4 to 6 digit PIN.", "pin.wrong": "That PIN is not right. {n} tries left.", "pin.wrong.1": "That PIN is not right. 1 try left.",
  "pin.locked15": "Too many wrong PINs. Try again in 15 minutes.", "pin.lockedAt": "Too many wrong PINs. Try again after {time}.",
  "net.load": "Could not load. Check your internet and try again.", "net.pin": "Could not check the PIN. Check your internet and try again.",
  "net.refresh": "Could not refresh. Check your internet and try again.", "net.send": "Could not send. Check your internet and try again.",
  "bill.monthly": "Monthly hire", "bill.trip": "Paid per trip",
  "bal.owed": "CIPCO owes you", "bal.ahead": "Paid ahead", "bal.balance": "Balance", "bal.since": "Unpaid since {date}", "bal.full": "You are fully paid.",
  "bal.earned": "Earned, all time", "bal.paid": "Paid, all time",
  "bal.unpriced": "{n} trips have no price yet, so they are not counted. The office will add them.", "bal.unpriced.1": "1 trip has no price yet, so it is not counted. The office will add it.",
  "add.btn": "Add a trip", "add.d": "A trip you ran for CIPCO outside your pickups and drops. It is paid once CIPCO approves it.",
  "f.date": "Date", "f.dateHint": "Up to 7 days back.", "f.what": "What was it for?", "f.whatPh": "e.g. Took cement bags from the yard to Block C",
  "f.who": "Who asked you?", "f.choose": "Choose…", "f.someone": "Someone else", "f.theirName": "Their name", "f.whoAria": "Name of the person who asked", "f.price": "Your price",
  "e.date": "Choose a date in the last 7 days.", "e.what": "Say what the trip was for.", "e.who": "Choose who asked you to run it.",
  "e.whoName": "Type the name of the person who asked.", "e.price": "Enter your price for the trip.",
  "cancel": "Cancel", "send": "Send for approval", "sending": "Sending…",
  "sent": "Sent for approval. CIPCO will approve it or reply, and you will see it under Trips you added.", "withdrawn": "Trip withdrawn.",
  "m.prev": "Previous month", "m.next": "Next month", "m.trips": "Pickups and drops", "m.monthly": "Monthly hire", "m.tripsRates": "{n} trips at {k} rates", "m.hireFrom": "Monthly hire from {date}",
  "m.show": "Show details", "m.hide": "Hide details", "m.noTrips": "No trips this month.", "m.noPrice": "no price yet", "m.pickup": "Pickup", "m.drop": "Drop",
  "m.monthlyLine": "Monthly hire, at the price in force on its first day ({date})", "m.erApproved": "Added trips approved", "m.total": "Total for {month}",
  "m.waiting": "₹{amt} in {n} added trips waiting for approval, not counted yet.", "m.waiting.1": "₹{amt} in 1 added trip waiting for approval, not counted yet.",
  "m.showed": "{n} showed up", "m.noshow": "{n} no-shows", "m.noshow.1": "1 no-show", "m.noshows": "No-shows: {list}",
  "m.notPaid": "No-show trips are not paid.", "m.raised": "CIPCO may raise no-show days with you.", "m.wrong": "If one is wrong, call the CIPCO office.",
  "er.t": "Trips you added in {month}", "st.awaiting": "Waiting for approval", "st.approved": "Approved", "st.rejected": "Not approved",
  "er.officeAmt": "The office will enter the amount", "er.youAskedSmall": "you asked ₹{amt}", "er.youAsked": "You asked ₹{amt}", "er.askedBy": "asked by {name}",
  "er.byOffice": "added by the office", "er.cipco": "CIPCO:", "er.withdraw": "Withdraw", "er.confirm": "Withdraw this trip?", "er.confirmAria": "Confirm withdraw",
  "er.yes": "Yes, withdraw", "er.withdrawing": "Withdrawing…", "er.keep": "Keep it", "er.none": "No trips added in {month}.",
  "pay.t": "Payments", "pay.all": "₹{amt} in all", "pay.none": "No payments yet.", "foot": "Questions about a figure? Call the CIPCO office.",
};
export type VKey = keyof typeof en;
type Dict = Partial<Record<VKey, string>> & Record<Exclude<VKey, `${string}.1`>, string>;

const hi: Dict = {
  "set.t": "अपना PIN खुद चुनें", "set.d": "ऑफिस ने आपको एक अस्थायी PIN दिया है। अब 4 से 6 अंकों का अपना PIN चुनें। यह सिर्फ़ आपको पता होगा।",
  "set.tExpired": "नया PIN रखने का समय", "set.dExpired": "आपका PIN 30 दिन पुराना हो गया है। 4 से 6 अंकों का नया PIN चुनें, जो पुराने से अलग हो।", "set.new": "नया PIN", "set.again": "नया PIN फिर से", "set.cur": "अभी का PIN", "set.save": "मेरा PIN सेव करें", "set.saving": "सेव हो रहा है…", "set.saved": "आपका PIN सेव हो गया। अगली बार यही PIN डालें। यह 30 दिन चलेगा, फिर आप नया PIN चुनेंगे।",
  "set.mismatch": "दोनों PIN एक जैसे नहीं हैं।", "set.weak": "यह PIN आसानी से अंदाज़ा लगाया जा सकता है। 1111 या 1234 जैसा PIN न रखें।", "set.same": "अभी वाले PIN से अलग PIN चुनें।",
  "set.curWrong": "आपका अभी का PIN सही नहीं है।", "set.change": "मेरा PIN बदलें", "set.changeT": "अपना PIN बदलें",
  "set.changeD": "पहले अपना अभी का PIN डालें, फिर नया PIN। आपके दूसरे फ़ोन पर नया PIN डालना होगा।", "set.forgot": "PIN भूल गए? CIPCO ऑफिस से अस्थायी PIN माँगें।",
  "f.from": "कहाँ से", "f.to": "कहाँ तक", "f.fromPh": "जैसे: यार्ड", "f.toPh": "जैसे: मुंद्रा पोर्ट",
  "e.from": "बताइए ट्रिप कहाँ से शुरू हुई।", "e.to": "बताइए ट्रिप कहाँ खत्म हुई।",
  "lang": "भाषा", "hdr.account": "वाहन खाता", "refresh": "ताज़ा करें", "refreshing": "ताज़ा हो रहा है", "signOut": "बाहर निकलें", "loading": "आपका खाता खुल रहा है…",
  "gone.t": "यह लिंक अब चालू नहीं है", "gone.d": "नया लिंक भेजने के लिए CIPCO ऑफिस से कहें।",
  "pin.t": "अपना PIN डालें", "pin.d": "अपना PIN डालें। पहली बार, CIPCO ऑफिस का दिया अस्थायी PIN डालें।", "pin.label": "PIN", "pin.hint": "4 से 6 अंक।", "pin.show": "दिखाएँ", "pin.hide": "छिपाएँ",
  "pin.open": "मेरा खाता खोलें", "pin.checking": "जाँच हो रही है…", "pin.forgot": "PIN भूल गए? CIPCO ऑफिस से अस्थायी PIN माँगें।",
  "pin.again": "आपकी सुरक्षा के लिए, कृपया अपना PIN फिर से डालें।", "pin.againErrand": "आपकी सुरक्षा के लिए, कृपया अपना PIN फिर से डालें। आपकी ट्रिप नहीं भेजी गई।",
  "pin.bad": "4 से 6 अंकों का PIN डालें।", "pin.wrong": "यह PIN सही नहीं है। आप {n} बार और कोशिश कर सकते हैं।", "pin.wrong.1": "यह PIN सही नहीं है। आप 1 बार और कोशिश कर सकते हैं।",
  "pin.locked15": "बहुत बार गलत PIN डाला गया। 15 मिनट बाद फिर कोशिश करें।", "pin.lockedAt": "बहुत बार गलत PIN डाला गया। {time} के बाद फिर कोशिश करें।",
  "net.load": "खाता नहीं खुल सका। अपना इंटरनेट देखें और फिर कोशिश करें।", "net.pin": "PIN की जाँच नहीं हो सकी। अपना इंटरनेट देखें और फिर कोशिश करें।",
  "net.refresh": "ताज़ा नहीं हो सका। अपना इंटरनेट देखें और फिर कोशिश करें।", "net.send": "भेजा नहीं जा सका। अपना इंटरनेट देखें और फिर कोशिश करें।",
  "bill.monthly": "मासिक किराया", "bill.trip": "हर ट्रिप का भुगतान",
  "bal.owed": "CIPCO को आपको देना है", "bal.ahead": "ज़्यादा भुगतान हो चुका है", "bal.balance": "बाकी", "bal.since": "{date} से बकाया", "bal.full": "आपका पूरा भुगतान हो चुका है।",
  "bal.earned": "कुल कमाई", "bal.paid": "कुल भुगतान मिला",
  "bal.unpriced": "{n} ट्रिप की कीमत अभी तय नहीं है, इसलिए वे गिनी नहीं गईं। ऑफिस इन्हें जोड़ देगा।",
  "add.btn": "ट्रिप जोड़ें", "add.d": "पिकअप और ड्रॉप के अलावा CIPCO के लिए की गई कोई ट्रिप। CIPCO की मंज़ूरी के बाद इसका भुगतान होगा।",
  "f.date": "तारीख", "f.dateHint": "पिछले 7 दिनों तक।", "f.what": "यह ट्रिप किसलिए थी?", "f.whatPh": "जैसे: यार्ड से सीमेंट की बोरियाँ ब्लॉक C तक ले गए",
  "f.who": "आपको किसने कहा?", "f.choose": "चुनें…", "f.someone": "कोई और", "f.theirName": "उनका नाम", "f.whoAria": "जिसने कहा उनका नाम", "f.price": "आपकी कीमत",
  "e.date": "पिछले 7 दिनों में से कोई तारीख चुनें।", "e.what": "बताइए कि यह ट्रिप किसलिए थी।", "e.who": "चुनें कि आपको यह ट्रिप किसने कहा।",
  "e.whoName": "जिसने कहा, उनका नाम लिखें।", "e.price": "इस ट्रिप की अपनी कीमत डालें।",
  "cancel": "रद्द करें", "send": "मंज़ूरी के लिए भेजें", "sending": "भेजा जा रहा है…",
  "sent": "मंज़ूरी के लिए भेज दिया गया। CIPCO मंज़ूरी देगा या जवाब देगा, और यह आपको नीचे जोड़ी गई ट्रिप में दिखेगा।", "withdrawn": "ट्रिप वापस ले ली गई।",
  "m.prev": "पिछला महीना", "m.next": "अगला महीना", "m.trips": "पिकअप और ड्रॉप", "m.monthly": "मासिक किराया", "m.tripsRates": "{n} ट्रिप, {k} अलग दरों पर", "m.hireFrom": "{date} से मासिक किराया",
  "m.show": "विवरण दिखाएँ", "m.hide": "विवरण छिपाएँ", "m.noTrips": "इस महीने कोई ट्रिप नहीं।", "m.noPrice": "कीमत अभी तय नहीं", "m.pickup": "पिकअप", "m.drop": "ड्रॉप",
  "m.monthlyLine": "मासिक किराया, पहले दिन ({date}) की दर पर", "m.erApproved": "मंज़ूर जोड़ी गई ट्रिप", "m.total": "{month} का कुल",
  "m.waiting": "₹{amt} की {n} जोड़ी गई ट्रिप मंज़ूरी के इंतज़ार में हैं, अभी गिनी नहीं गईं।",
  "m.showed": "{n} ट्रिप पर आए", "m.noshow": "{n} ट्रिप पर नहीं आए", "m.noshows": "नहीं आए: {list}",
  "m.notPaid": "जिन ट्रिप पर गाड़ी नहीं आई, उनका भुगतान नहीं होता।", "m.raised": "CIPCO न आने वाले दिनों के बारे में आपसे बात कर सकता है।", "m.wrong": "अगर कोई गलत है, तो CIPCO ऑफिस को फ़ोन करें।",
  "er.t": "{month} में जोड़ी गई ट्रिप", "st.awaiting": "मंज़ूरी का इंतज़ार", "st.approved": "मंज़ूर", "st.rejected": "मंज़ूर नहीं",
  "er.officeAmt": "रकम ऑफिस डालेगा", "er.youAskedSmall": "आपने ₹{amt} माँगे थे", "er.youAsked": "आपने ₹{amt} माँगे थे", "er.askedBy": "{name} ने कहा",
  "er.byOffice": "ऑफिस ने जोड़ा", "er.cipco": "CIPCO:", "er.withdraw": "वापस लें", "er.confirm": "यह ट्रिप वापस लेनी है?", "er.confirmAria": "वापस लेने की पुष्टि",
  "er.yes": "हाँ, वापस लें", "er.withdrawing": "वापस लिया जा रहा है…", "er.keep": "रहने दें", "er.none": "{month} में कोई ट्रिप नहीं जोड़ी गई।",
  "pay.t": "भुगतान", "pay.all": "कुल ₹{amt}", "pay.none": "अभी कोई भुगतान नहीं।", "foot": "किसी रकम के बारे में सवाल है? CIPCO ऑफिस को फ़ोन करें।",
};

const gu: Dict = {
  "set.t": "તમારો પોતાનો PIN પસંદ કરો", "set.d": "ઑફિસે તમને કામચલાઉ PIN આપ્યો છે. હવે 4 થી 6 અંકનો તમારો પોતાનો PIN પસંદ કરો. તે ફક્ત તમને જ ખબર હશે.",
  "set.tExpired": "નવો PIN રાખવાનો સમય", "set.dExpired": "તમારો PIN 30 દિવસ જૂનો થઈ ગયો છે. 4 થી 6 અંકનો નવો PIN પસંદ કરો, જે જૂના કરતાં અલગ હોય.", "set.new": "નવો PIN", "set.again": "નવો PIN ફરીથી", "set.cur": "હાલનો PIN", "set.save": "મારો PIN સેવ કરો", "set.saving": "સેવ થઈ રહ્યું છે…", "set.saved": "તમારો PIN સેવ થઈ ગયો. આગલી વખતે આ જ PIN નાખો. તે 30 દિવસ ચાલશે, પછી તમે નવો PIN પસંદ કરશો.",
  "set.mismatch": "બંને PIN સરખા નથી.", "set.weak": "આ PIN સહેલાઈથી ધારી શકાય છે. 1111 કે 1234 જેવો PIN ન રાખો.", "set.same": "હાલના PIN કરતાં અલગ PIN પસંદ કરો.",
  "set.curWrong": "તમારો હાલનો PIN સાચો નથી.", "set.change": "મારો PIN બદલો", "set.changeT": "તમારો PIN બદલો",
  "set.changeD": "પહેલાં તમારો હાલનો PIN નાખો, પછી નવો PIN. તમારા બીજા ફોન પર નવો PIN નાખવો પડશે.", "set.forgot": "PIN ભૂલી ગયા? CIPCO ઑફિસ પાસેથી કામચલાઉ PIN માગો.",
  "f.from": "ક્યાંથી", "f.to": "ક્યાં સુધી", "f.fromPh": "દા.ત. યાર્ડ", "f.toPh": "દા.ત. મુંદ્રા પોર્ટ",
  "e.from": "ટ્રિપ ક્યાંથી શરૂ થઈ તે લખો.", "e.to": "ટ્રિપ ક્યાં પૂરી થઈ તે લખો.",
  "lang": "ભાષા", "hdr.account": "વાહન ખાતું", "refresh": "તાજું કરો", "refreshing": "તાજું થઈ રહ્યું છે", "signOut": "બહાર નીકળો", "loading": "તમારું ખાતું ખુલી રહ્યું છે…",
  "gone.t": "આ લિંક હવે ચાલુ નથી", "gone.d": "નવી લિંક મોકલવા CIPCO ઑફિસને કહો.",
  "pin.t": "તમારો PIN નાખો", "pin.d": "તમારો PIN નાખો. પહેલી વાર, CIPCO ઑફિસે આપેલો કામચલાઉ PIN નાખો.", "pin.label": "PIN", "pin.hint": "4 થી 6 અંક.", "pin.show": "બતાવો", "pin.hide": "છુપાવો",
  "pin.open": "મારું ખાતું ખોલો", "pin.checking": "તપાસ થઈ રહી છે…", "pin.forgot": "PIN ભૂલી ગયા? CIPCO ઑફિસ પાસેથી કામચલાઉ PIN માગો.",
  "pin.again": "તમારી સલામતી માટે, કૃપા કરીને તમારો PIN ફરી નાખો.", "pin.againErrand": "તમારી સલામતી માટે, કૃપા કરીને તમારો PIN ફરી નાખો. તમારી ટ્રિપ મોકલાઈ નથી.",
  "pin.bad": "4 થી 6 અંકનો PIN નાખો.", "pin.wrong": "આ PIN સાચો નથી. તમે હજી {n} વખત પ્રયાસ કરી શકો છો.", "pin.wrong.1": "આ PIN સાચો નથી. તમે હજી 1 વખત પ્રયાસ કરી શકો છો.",
  "pin.locked15": "ઘણી વાર ખોટો PIN નખાયો. 15 મિનિટ પછી ફરી પ્રયાસ કરો.", "pin.lockedAt": "ઘણી વાર ખોટો PIN નખાયો. {time} પછી ફરી પ્રયાસ કરો.",
  "net.load": "ખાતું ખૂલી શક્યું નહીં. તમારું ઇન્ટરનેટ તપાસો અને ફરી પ્રયાસ કરો.", "net.pin": "PIN તપાસી શકાયો નહીં. તમારું ઇન્ટરનેટ તપાસો અને ફરી પ્રયાસ કરો.",
  "net.refresh": "તાજું થઈ શક્યું નહીં. તમારું ઇન્ટરનેટ તપાસો અને ફરી પ્રયાસ કરો.", "net.send": "મોકલી શકાયું નહીં. તમારું ઇન્ટરનેટ તપાસો અને ફરી પ્રયાસ કરો.",
  "bill.monthly": "માસિક ભાડું", "bill.trip": "દરેક ટ્રિપની ચુકવણી",
  "bal.owed": "CIPCO એ તમને આપવાના છે", "bal.ahead": "વધારે ચુકવણી થઈ ગઈ છે", "bal.balance": "બાકી", "bal.since": "{date} થી બાકી", "bal.full": "તમારી પૂરી ચુકવણી થઈ ગઈ છે.",
  "bal.earned": "કુલ કમાણી", "bal.paid": "કુલ મળેલી ચુકવણી",
  "bal.unpriced": "{n} ટ્રિપની કિંમત હજી નક્કી નથી, એટલે તે ગણાઈ નથી. ઑફિસ તે ઉમેરશે.",
  "add.btn": "ટ્રિપ ઉમેરો", "add.d": "પિકઅપ અને ડ્રોપ સિવાય CIPCO માટે કરેલી કોઈ ટ્રિપ. CIPCO મંજૂરી આપે પછી તેની ચુકવણી થશે.",
  "f.date": "તારીખ", "f.dateHint": "છેલ્લા 7 દિવસ સુધી.", "f.what": "આ ટ્રિપ શેના માટે હતી?", "f.whatPh": "દા.ત. યાર્ડથી સિમેન્ટની થેલીઓ બ્લોક C સુધી લઈ ગયા",
  "f.who": "તમને કોણે કહ્યું?", "f.choose": "પસંદ કરો…", "f.someone": "બીજું કોઈ", "f.theirName": "તેમનું નામ", "f.whoAria": "જેણે કહ્યું તેમનું નામ", "f.price": "તમારી કિંમત",
  "e.date": "છેલ્લા 7 દિવસમાંથી તારીખ પસંદ કરો.", "e.what": "આ ટ્રિપ શેના માટે હતી તે લખો.", "e.who": "તમને આ ટ્રિપ કોણે કહી તે પસંદ કરો.",
  "e.whoName": "જેણે કહ્યું તેમનું નામ લખો.", "e.price": "આ ટ્રિપની તમારી કિંમત નાખો.",
  "cancel": "રદ કરો", "send": "મંજૂરી માટે મોકલો", "sending": "મોકલાઈ રહ્યું છે…",
  "sent": "મંજૂરી માટે મોકલી દીધું. CIPCO મંજૂરી આપશે અથવા જવાબ આપશે, અને તે તમને નીચે ઉમેરેલી ટ્રિપમાં દેખાશે.", "withdrawn": "ટ્રિપ પાછી ખેંચી લીધી.",
  "m.prev": "પાછલો મહિનો", "m.next": "આગલો મહિનો", "m.trips": "પિકઅપ અને ડ્રોપ", "m.monthly": "માસિક ભાડું", "m.tripsRates": "{n} ટ્રિપ, {k} અલગ દરે", "m.hireFrom": "{date} થી માસિક ભાડું",
  "m.show": "વિગત બતાવો", "m.hide": "વિગત છુપાવો", "m.noTrips": "આ મહિને કોઈ ટ્રિપ નથી.", "m.noPrice": "કિંમત હજી નક્કી નથી", "m.pickup": "પિકઅપ", "m.drop": "ડ્રોપ",
  "m.monthlyLine": "માસિક ભાડું, પહેલા દિવસ ({date}) ના દરે", "m.erApproved": "મંજૂર ઉમેરેલી ટ્રિપ", "m.total": "{month} નો કુલ",
  "m.waiting": "₹{amt} ની {n} ઉમેરેલી ટ્રિપ મંજૂરીની રાહ જુએ છે, હજી ગણાઈ નથી.",
  "m.showed": "{n} ટ્રિપમાં હાજર", "m.noshow": "{n} ટ્રિપમાં ગેરહાજર", "m.noshows": "ગેરહાજર: {list}",
  "m.notPaid": "જે ટ્રિપમાં વાહન આવ્યું નહીં તેની ચુકવણી થતી નથી.", "m.raised": "ગેરહાજર દિવસો વિશે CIPCO તમારી સાથે વાત કરી શકે છે.", "m.wrong": "જો કોઈ ખોટું હોય, તો CIPCO ઑફિસને ફોન કરો.",
  "er.t": "{month} માં ઉમેરેલી ટ્રિપ", "st.awaiting": "મંજૂરીની રાહ", "st.approved": "મંજૂર", "st.rejected": "મંજૂર નથી",
  "er.officeAmt": "રકમ ઑફિસ નાખશે", "er.youAskedSmall": "તમે ₹{amt} માગ્યા હતા", "er.youAsked": "તમે ₹{amt} માગ્યા હતા", "er.askedBy": "{name} એ કહ્યું",
  "er.byOffice": "ઑફિસે ઉમેર્યું", "er.cipco": "CIPCO:", "er.withdraw": "પાછું ખેંચો", "er.confirm": "આ ટ્રિપ પાછી ખેંચવી છે?", "er.confirmAria": "પાછું ખેંચવાની પુષ્ટિ",
  "er.yes": "હા, પાછું ખેંચો", "er.withdrawing": "પાછું ખેંચાઈ રહ્યું છે…", "er.keep": "રહેવા દો", "er.none": "{month} માં કોઈ ટ્રિપ ઉમેરાઈ નથી.",
  "pay.t": "ચુકવણી", "pay.all": "કુલ ₹{amt}", "pay.none": "હજી કોઈ ચુકવણી નથી.", "foot": "કોઈ રકમ વિશે સવાલ છે? CIPCO ઑફિસને ફોન કરો.",
};

const DICTS: Record<VLang, Partial<Record<VKey, string>>> = { en, hi, gu };
export type VT = (key: VKey, vars?: Record<string, string | number>) => string;
/** t("bal.since", { date }); with { n: 1 } it prefers the ".1" form (English singulars). */
export function makeVT(lang: VLang): VT {
  const d = DICTS[lang];
  return (key, vars) => {
    const one = vars?.n === 1 ? (`${key}.1` as VKey) : null;
    let s = (one && (d[one] ?? (lang === "en" ? en[one] : undefined))) || d[key] || en[key] || key;
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.split(`{${k}}`).join(String(v)); });
    return s;
  };
}
export const localeOf = (l: VLang) => VENDOR_LANGS.find((x) => x.code === l)!.locale;

/** The database's PIN messages are in English: say them in the chosen language. Anything unknown is shown as it came. */
export function pinMessage(raw: string, t: VT): string {
  let m = raw.match(/(\d+) tr(?:y|ies) left/); if (/PIN is not right/.test(raw) && m) return t("pin.wrong", { n: Number(m[1]) });
  if (/Try again in 15 minutes/.test(raw)) return t("pin.locked15");
  m = raw.match(/Try again after (\d{1,2}:\d{2})/); if (m) return t("pin.lockedAt", { time: m[1] });
  return raw;
}
