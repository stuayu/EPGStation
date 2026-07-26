import eslintJs from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**', 'client/**', 'node_modules/**', 'ormconfig.js'],
    },
    eslintJs.configs.recommended,
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                sourceType: 'module',
                project: './tsconfig.json',
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
            },
        },
        rules: {
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-namespace': 'off',
            // require() は swagger-ui-dist の解決などで使用しているため許可する
            '@typescript-eslint/no-require-imports': 'off',
            'no-constant-condition': 'off',
            // ESLint v10 の recommended で追加されたルール。既存コードの記述を維持するため無効化
            'no-useless-assignment': 'off',
            'preserve-caught-error': 'off',
            'no-useless-escape': 'off',
            'no-async-promise-executor': 'off',
            'max-len': [
                'error',
                {
                    code: 180,
                    tabWidth: 4,
                    ignoreComments: true,
                    ignoreTrailingComments: true,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreRegExpLiterals: true,
                },
            ],
        },
    },
);
