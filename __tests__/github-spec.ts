import { getHtmlUrl } from '../src/github';
import { IFile } from '../src/interfaces';

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

function file(htmlUrl: string | null): IFile {
  return {
    size: 100,
    path: '.github/workflows/windows.yml',
    url:
      'https://api.github.com/repos/grame-cncm/faust/contents/.github/workflows/windows.yml?ref=master-dev',
    html_url: htmlUrl,
    download_url:
      'https://raw.githubusercontent.com/grame-cncm/faust/master-dev/.github/workflows/windows.yml',
  };
}

describe('canonical workflow source links', () => {
  test('uses the API-provided HTML URL without parsing or guessing its branch', () => {
    for (const htmlUrl of [
      'https://github.com/grame-cncm/faust/blob/master-dev/.github/workflows/windows.yml',
      'https://github.com/katursis/Pawn.RakNet/blob/0.3.7/.github/workflows/build.yml',
      'https://github.com/cocos/cocos-engine/blob/v3.8.8/.github/workflows/native-unit-test.yml',
      'https://github.com/acme/project/blob/release/v1.2/.github/workflows/build.yml',
      'https://github.com/acme/project/blob/release%2Fv1.2/.github/workflows/build%20linux.yml',
      'https://github.com/acme/project/blob/main/.github/workflows/ci.yml.bak',
      `https://github.com/acme/project/blob/${'a'.repeat(
        40
      )}/.github/workflows/build.yml`,
    ]) {
      const source = file(htmlUrl);
      expect(getHtmlUrl(source, 24)).toBe(`${htmlUrl}#L24`);
      expect(source.html_url).toBe(htmlUrl);
    }
  });

  test('sets one exact line anchor without changing the path or query', () => {
    expect(
      getHtmlUrl(
        file(
          'https://github.com/acme/project/blob/master-dev/.github/workflows/windows.yml?plain=1#L10'
        ),
        37
      )
    ).toBe(
      'https://github.com/acme/project/blob/master-dev/.github/workflows/windows.yml?plain=1#L37'
    );
  });

  test('rejects unavailable or invalid HTML URLs instead of fabricating a main-branch link', () => {
    for (const url of [
      null,
      '',
      'not a URL',
      'https://api.github.com/repos/acme/project/contents/.github/workflows/build.yml?ref=master-dev',
      'https://github.com/acme/project',
      'https://github.com.evil.example/acme/project/blob/main/build.yml',
      'http://github.com/acme/project/blob/main/build.yml',
      'javascript:alert(1)',
    ]) {
      expect(() => getHtmlUrl(file(url), 24)).toThrow();
    }
  });

  test('rejects invalid line references', () => {
    const source = file(
      'https://github.com/grame-cncm/faust/blob/master-dev/.github/workflows/windows.yml'
    );
    for (const line of [0, -1, 1.5, NaN, Infinity])
      expect(() => getHtmlUrl(source, line)).toThrow('positive integer');
  });
});
