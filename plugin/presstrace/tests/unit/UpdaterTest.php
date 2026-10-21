<?php
/**
 * Tests for PressTrace_Updater::parse_release().
 *
 * @package PressTrace
 */

use PHPUnit\Framework\TestCase;

class UpdaterTest extends TestCase {

	private function release( array $overrides = array() ) {
		return array_merge(
			array(
				'tag_name'   => 'v0.2.0',
				'html_url'   => 'https://github.com/onwp/presstrace-wordpress-apm/releases/tag/v0.2.0',
				'draft'      => false,
				'prerelease' => false,
				'assets'     => array(
					array(
						'name'                 => 'presstrace-app-0.2.0.tar.gz',
						'browser_download_url' => 'https://github.com/onwp/presstrace-wordpress-apm/releases/download/v0.2.0/presstrace-app-0.2.0.tar.gz',
					),
					array(
						'name'                 => 'presstrace-0.2.0.zip',
						'browser_download_url' => 'https://github.com/onwp/presstrace-wordpress-apm/releases/download/v0.2.0/presstrace-0.2.0.zip',
					),
				),
			),
			$overrides
		);
	}

	public function test_release_with_plugin_zip() {
		$this->assertSame(
			array(
				'id'      => 'https://github.com/onwp/presstrace-wordpress-apm',
				'version' => '0.2.0',
				'url'     => 'https://github.com/onwp/presstrace-wordpress-apm/releases/tag/v0.2.0',
				'package' => 'https://github.com/onwp/presstrace-wordpress-apm/releases/download/v0.2.0/presstrace-0.2.0.zip',
			),
			PressTrace_Updater::parse_release( $this->release() )
		);
	}

	public function test_skips_prereleases_and_drafts() {
		$this->assertNull( PressTrace_Updater::parse_release( $this->release( array( 'prerelease' => true ) ) ) );
		$this->assertNull( PressTrace_Updater::parse_release( $this->release( array( 'draft' => true ) ) ) );
	}

	public function test_skips_bad_tags() {
		$this->assertNull( PressTrace_Updater::parse_release( $this->release( array( 'tag_name' => 'v0.2.0-rc.1' ) ) ) );
		$this->assertNull( PressTrace_Updater::parse_release( $this->release( array( 'tag_name' => 'latest' ) ) ) );
		$this->assertNull( PressTrace_Updater::parse_release( array() ) );
	}

	public function test_requires_matching_zip_from_this_repo() {
		$this->assertNull( PressTrace_Updater::parse_release( $this->release( array( 'assets' => array() ) ) ) );
		$this->assertNull(
			PressTrace_Updater::parse_release(
				$this->release(
					array(
						'assets' => array(
							array(
								'name'                 => 'presstrace-0.2.0.zip',
								'browser_download_url' => 'https://example.com/presstrace-0.2.0.zip',
							),
						),
					)
				)
			)
		);
	}
}
