const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
puppeteer.use(AdblockerPlugin({
    blockTrackers: true
}));
const UserAgents = require('user-agents');
const fetch = require("node-fetch")
const {
    Buffer
} = require('buffer');
const CronJob = require('cron').CronJob;
require('dotenv').config()


async function signOn(page) {
    if (await page.$(".nav li a span.fa.fa-share") != undefined) {
        await page.goto("https://ocw.uns.ac.id/saml/login")

        try {
            if (!process.env.EMAIL || !process.env.PASSWORD) {
                console.log(`[INFO] : DON'T FORGET SET ENV EMAIL DAN PASSWORD`)
            }

            await page.type("input[name='username']", process.env.EMAIL);
            await page.type("input[name='password']", process.env.PASSWORD);
            await page.click("button[type='submit']")
        } catch (e) {
            console.log(e.message)
        }
    }
}

function decodeBase64(base64) {
    return new Buffer.from(new Buffer.from(base64, 'base64').toString('ascii'), 'base64').toString('ascii')
}


(async () => {

    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
        '--disable-accelerated-2d-canvas',
        '--no-zygote',
        '--no-first-run',
        '--disable-dev-shm-usage',
        '--window-size=1920x1080'
    ];

    const browser = await puppeteer.launch({
        headless: false,
        ignoreHTTPSErrors: true,
        slowMo: 0,
        devtools: false,
        args
    });

    const page = await browser.pages()
    const userAgent = new UserAgents();
    await page[0].setUserAgent(userAgent.toString());
    await page[0].setDefaultNavigationTimeout(0);
    await page[0].goto("https://ocw.uns.ac.id/site/index");

    await signOn(page[0])

    await page[0].waitForSelector("#daftar-makul")
    const listMatkul = await page[0].$$eval(".daftar-makul a", (el) => el.map((n) => {
        const [matkul, dosen, kelas] = n.innerText.split("  ")[1].split(" - ")
        const url = n.href

        return {
            matkul,
            dosen,
            kelas,
            url
        }
    }))


    // check every 15 minutes between 7 - 18 on weekdays
    // https://cron.guru
    const job = new CronJob('*/15 7-18 * * 1-5', async function () {
        await signOn(page[0]);

        if (listMatkul) {
            await page[0].goto(listMatkul[0].url);
            await page[0].waitForSelector(".list-kuliah-aktif")
            const matkulAktif = await page[0].$$eval(".list-kuliah-aktif a.btn-danger", (el) => el.map((n) => n.innerText.replace(" ", "")))


            if (matkulAktif.length > 0) {
                for (matkul of matkulAktif) {

                    const findUrl = listMatkul.find((value) => (value.matkul == matkul))

                    if (findUrl) {
                        await page[0].goto(findUrl.url)
                        await page[0].waitForSelector(".row .panel-body")
                        const panelAbsen = await page[0].$eval(".panel.panel-default .panel-body", async (el) => {
                            const [date, meetingCount, time, information] = el.innerText.split("\n\n");
                            const url = "https://ocw.uns.ac.id" + el.innerHTML.split(`href="`)[1].split(`"`)[0];

                            return {
                                date,
                                meetingCount,
                                time,
                                information,
                                url
                            }
                        })

                        if (panelAbsen.information == "Kehadiran Anda: ALPHA") {
                            console.log(`[INFO] : ${panelAbsen.date} ${panelAbsen.time} | ${findUrl.matkul} - ${panelAbsen.meetingCount}`)

                            const idMahasiswa = process.env.IDMAHASISWA;
                            if (!process.env.IDMAHASISWA) {
                                console.log(`DON'T FORGET SET ENV IDMAHASISWA`)
                            }

                            const presensiId = decodeBase64(panelAbsen.url.split("id=")[1])

                            const postAbsensi = await fetch(`https://siakad.uns.ac.id/services/v1/presensi/update-presensi-mhs-daring-mbkm?id=${presensiId}`, {
                                method: "POST",
                                headers: {
                                    "Host": "siakad.uns.ac.id",
                                    "Connection": "keep-alive",
                                    "sec-ch-ua": "\"Chromium\";v=\"94\", \"Google Chrome\";v=\"94\", \";Not A Brand\";v=\"99\"",
                                    "Accept": "*/*",
                                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                                    "sec-ch-ua-mobile": "?0",
                                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36",
                                    "sec-ch-ua-platform": "\"Linux\"",
                                    "Origin": "https://ocw.uns.ac.id",
                                    "Sec-Fetch-Site": "same-site",
                                    "Sec-Fetch-Mode": "cors",
                                    "Sec-Fetch-Dest": "empty",
                                    "Referer": "https://ocw.uns.ac.id/",
                                    "Accept-Encoding": "gzip, deflate, br",
                                    "Accept-Language": "en-US,en;q=0.9"
                                },
                                body: `idMhs=${idMahasiswa}&latitude=${process.env.LATITUDE}&longitude=${process.env.LONGITUDE}&KESEHATAN=SEHAT&idMhsLogin=`
                            }).then((res) => res.json())

                            if (postAbsensi.code == 200) {
                                console.log(`[INFO] : Sukses Absensi ${findUrl.matkul} - ${panelAbsen.meetingCount}`)
                                await page[0].goto(findUrl.url)
                            } else {
                                console.log(`[INFO] : Gagal Absensi ${postAbsensi.data}`)
                            }
                        }
                    }
                }
            } else {
                console.log("[INFO] : Tidak ada absensi")
            }
        }
    });

    job.start();
})()