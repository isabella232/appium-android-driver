import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import _ from 'lodash';
import { retryInterval } from 'asyncbox';
import AndroidDriver from '../../../../lib/driver';
import B from 'bluebird';
import { DEFAULT_CAPS, amendCapabilities } from '../../capabilities';


chai.should();
chai.use(chaiAsPromised);

const BUTTON_CLASS = 'android.widget.Button';
const EDITTEXT_CLASS = 'android.widget.EditText';
const TEXTVIEW_CLASS = 'android.widget.TextView';

const PACKAGE = 'io.appium.android.apis';
const TEXTFIELD_ACTIVITY = '.view.TextFields';
const KEYEVENT_ACTIVITY = '.text.KeyEventText';

const defaultAsciiCaps = amendCapabilities(DEFAULT_CAPS, {
  'appium:newCommandTimeout': 90,
  'appium:appActivity': TEXTFIELD_ACTIVITY,
});

const defaultUnicodeCaps = amendCapabilities(defaultAsciiCaps, {
  'appium:unicodeKeyboard': true,
  'appium:resetKeyboard': true
});

function deSamsungify (text) {
  // For samsung S5 text is appended with ". Editing."
  return text.replace('. Editing.', '');
}

async function getElement (driver, className) {
  const els = await driver.findElements('class name', className);
  els.should.have.length.at.least(1);
  let el = _.last(els);
  return el.ELEMENT;
}

async function runTextEditTest (driver, testText, keys = false) {
  let el = await getElement(driver, EDITTEXT_CLASS);
  await driver.clear(el);

  if (keys) {
    await driver.keys([testText]);
  } else {
    await driver.setValue(testText, el);
  }

  let text = await driver.getText(el);
  testText.should.include(deSamsungify(text));
  return el;
}

/*
 * The key event page needs to be cleared between runs, or else we get false
 * positives from previously run tests. The page has a single button that
 * removes all text from within the main TextView.
 */
async function clearKeyEvents (driver) {
  let el = await getElement(driver, BUTTON_CLASS);
  driver.click(el);

  // wait a moment for the clearing to occur, lest we too quickly try to enter more text
  await B.delay(500);
}

async function runCombinationKeyEventTest (driver) {
  let runTest = async function () {
    await driver.pressKeyCode(29, 193);
    let el = await getElement(driver, TEXTVIEW_CLASS);
    return await driver.getText(el);
  };

  await clearKeyEvents(driver);

  let text = await runTest();
  if (text === '') {
    // the test is flakey... try again
    text = await runTest();
  }
  text.should.include('keyCode=KEYCODE_A');
  text.should.include('metaState=META_SHIFT_ON');
}

async function runKeyEventTest (driver) {
  let runTest = async function () {
    await driver.pressKeyCode(82);
    let el = await getElement(driver, TEXTVIEW_CLASS);
    return await driver.getText(el);
  };

  await clearKeyEvents(driver);

  let text = await runTest();
  if (text === '') {
    // the test is flakey... try again
    text = await runTest();
  }
  text.should.include('[keycode=82]');
  text.should.include('keyCode=KEYCODE_MENU');
}

const tests = [
  {label: 'editing a text field', text: 'Life, the Universe and Everything.'},
  {label: 'sending \'&-\'', text: '&-'},
  {label: 'sending \'&\' and \'-\' in other text', text: 'In the mid-1990s he ate fish & chips as mayor-elect.'},
  {label: 'sending \'-\' in text', text: 'Super-test.'},
  {label: 'sending numbers', text: '0123456789'},
];

const unicodeTests = [
  {label: 'should be able to send \'-\' in unicode text', text: 'परीक्षा-परीक्षण'},
  {label: 'should be able to send \'&\' in text', text: 'Fish & chips'},
  {label: 'should be able to send \'&\' in unicode text', text: 'Mīna & chips'},
  {label: 'should be able to send roman characters with diacritics', text: 'Áé Œ ù ḍ'},
  {label: 'should be able to send a \'u\' with an umlaut', text: 'ü'},
];

const languageTests = [
  {label: 'should be able to send Tamil', text: 'சோதனை'},
  {label: 'should be able to send Chinese', text: '测试'},
  {label: 'should be able to send Arabic', text: 'تجريب'},
  {label: 'should be able to send Hebrew', text: 'בדיקות'},
];

async function ensureUnlocked (driver) {
  // on Travis the device is sometimes not unlocked
  await retryInterval(10, 1000, async function () {
    if (!await driver.isLocked()) {
      return;
    }
    console.log(`\n\nDevice locked. Attempting to unlock`); // eslint-disable-line
    await driver.unlock();
    // trigger another iteration
    throw new Error(`The device is locked.`);
  });
}

describe('keyboard', function () {
  this.retries(3);

  describe('ascii', function () {
    let driver;
    before(async function () {
      driver = new AndroidDriver();
      await driver.createSession(defaultAsciiCaps);

      // sometimes the default ime is not what we are using
      let engines = await driver.availableIMEEngines();
      let selectedEngine = _.head(engines);
      for (let engine of engines) {
        // it seems that the latin ime has `android.inputmethod` in its package name
        if (engine.indexOf('android.inputmethod') !== -1) {
          selectedEngine = engine;
        }
      }
      await driver.activateIMEEngine(selectedEngine);
    });
    after(async function () {
      await driver.deleteSession();
    });

    beforeEach(async function () {
      await ensureUnlocked(driver);
    });

    describe('editing a text field', function () {
      for (const test of tests) {
        describe(test.label, function () {
          it(`should work with setValue: '${test.text}'`, async function () {
            await runTextEditTest(driver, test.text);
          });
          it(`should work with keys: '${test.text}'`, async function () {
            await runTextEditTest(driver, test.text, true);
          });
        });
      }

      it('should be able to clear a password field', async function () {
        const els = await driver.findElements('class name', EDITTEXT_CLASS);
        els.should.have.length.at.least(1);

        // the second field is the password field
        const el = els[1].ELEMENT;

        await driver.setValue('super-duper password', el);

        // the text is printed into a text field, so we can retrieve and assert
        let textEl = await driver.findElement('id', 'edit1Text');
        let text = await driver.getText(textEl.ELEMENT);
        text.should.eql('super-duper password');

        await driver.clear(el);

        text = await driver.getText(textEl.ELEMENT);
        text.should.eql('');
      });
    });

    describe('sending a key event', function () {
      before(async function () {
        await driver.startActivity(PACKAGE, KEYEVENT_ACTIVITY);
        await B.delay(500);
      });

      it('should be able to send combination keyevents', async function () {
        await runCombinationKeyEventTest(driver);
      });
      it('should be able to send keyevents', async function () {
        await runKeyEventTest(driver);
      });
    });
  });

  describe('unicode', function () {
    let driver;
    before(async function () {
      driver = new AndroidDriver();
      await driver.createSession(defaultUnicodeCaps);
    });
    after(async function () {
      await driver.deleteSession();
    });

    beforeEach(async function () {
      await ensureUnlocked(driver);
    });

    describe('editing a text field', function () {
      for (const testSet of [tests, unicodeTests, languageTests]) {
        for (const test of testSet) {
          describe(test.label, function () {
            it(`should work with setValue: '${test.text}'`, async function () {
              await runTextEditTest(driver, test.text);
            });
            it(`should work with keys: '${test.text}'`, async function () {
              await runTextEditTest(driver, test.text, true);
            });
          });
        }
      }
    });

    describe('sending a key event', function () {
      before(async function () {
        await driver.startActivity(PACKAGE, KEYEVENT_ACTIVITY);
      });

      it('should be able to send combination keyevents', async function () {
        await runCombinationKeyEventTest(driver);
      });
      it('should be able to send keyevents', async function () {
        await runKeyEventTest(driver);
      });
    });
  });
});
