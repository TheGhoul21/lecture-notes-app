const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class LatexCompiler {
  constructor(options = {}) {
    this.latexCommand = options.latexCommand || 'pdflatex';
    this.maxRuns = options.maxRuns || 3;
    this.timeout = options.timeout || 30000;
    this.tempDir = options.tempDir || './tmp';

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async compile(latexFilePath) {
    const latexFileName = path.basename(latexFilePath);
    const latexFileBaseName = path.basename(latexFilePath, path.extname(latexFilePath));
    const tempLatexFilePath = path.join(this.tempDir, latexFileName);

    try {
      fs.copyFileSync(latexFilePath, tempLatexFilePath);
    } catch (err) {
      throw new Error(`Failed to copy LaTeX file to temporary directory: ${err.message}`);
    }

    let runCount = 0;
    let lastLog = '';
    let errorFound = false;

    while (runCount < this.maxRuns) {
      runCount++;
      try {
        const { stdout, stderr } = await this.runLatex(tempLatexFilePath);
        lastLog = stdout;

        if (stderr) {
          errorFound = true;
        }

        if (stdout.includes('!')) {
          errorFound = true;
        }

        if (!stdout.includes('Rerun') && !stdout.includes('undefined references')) {
          break;
        }
      } catch (err) {
        errorFound = true;
        lastLog = err.stdout ? err.stdout : '';
        lastLog += err.stderr ? err.stderr : '';
        break;
      }
    }

    const pdfFilePath = path.join(this.tempDir, `${latexFileBaseName}.pdf`);
    const pdfExists = fs.existsSync(pdfFilePath);

    if (errorFound || !pdfExists) {
      const errors = this.extractErrors(lastLog);
      return {
        success: false,
        errors: errors,
        pdfPath: null,
      };
    } else {
      return {
        success: true,
        errors: [],
        pdfPath: pdfFilePath,
      };
    }
  }

  runLatex(latexFilePath) {
    return new Promise((resolve, reject) => {
      const command = `${this.latexCommand} -interaction=nonstopmode -output-directory=${this.tempDir} ${latexFilePath}`;
      const latexProcess = exec(command, { timeout: this.timeout });

      let stdout = '';
      let stderr = '';

      latexProcess.stdout.on('data', (data) => {
        stdout += data;
      });

      latexProcess.stderr.on('data', (data) => {
        stderr += data;
      });

      latexProcess.on('error', (err) => {
        reject({ message: `Failed to start pdflatex process: ${err.message}`, stdout, stderr });
      });

      latexProcess.on('exit', (code) => {
        if (code !== 0) {
          reject({ message: `pdflatex process exited with code ${code}`, stdout, stderr });
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  extractErrors(log) {
    const errorRegex = /^! ([\s\S]+?)^l\.(\d+)( [\s\S]+?(?=\n!? |\n\n))/gim;
    
    const matches = [];
    let match;

    while ((match = errorRegex.exec(log)) !== null) {
      const errorMsg = match[1].trim();
      const lineNum = parseInt(match[2]);
      const snippet = match[3].trim();

      matches.push({
        error: errorMsg,
        line: lineNum,
        snippet: snippet
      });
    }
    return matches;
  }

  async cleanup() {
    try {
      await fs.promises.rm(this.tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to remove temporary directory: ${err.message}`);
    }
  }
}

// Example Usage:
async function main() {
  const compiler = new LatexCompiler({
    maxRuns: 3,
  });

  try {
    const result = await compiler.compile('./main.tex');

    if (result.success) {
      console.log('PDF compiled successfully!');
      console.log('PDF path:', result.pdfPath);
    } else {
      console.error('PDF compilation failed!');
      if (result.errors.length > 0) {
        console.error('Errors:');
        result.errors.forEach((errInfo, index) => {
          console.error(`  Error ${index + 1}:`);
          console.error(`    Message: ${errInfo.error}`);
          console.error(`    Line: ${errInfo.line}`);
          console.error(`    Snippet: ${errInfo.snippet}`);
        });
      } else {
        console.error('No specific errors found in the log, but compilation failed.');
      }
    }
  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    await compiler.cleanup();
  }
}


module.exports = {LatexCompiler}